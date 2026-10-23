import {
  agentBranchName,
  commitAllChanges,
  createTaskWorktree,
  deleteAgentBranch,
  diffSince,
  removeTaskWorktree,
  type FileChange,
  type TaskWorktree,
} from '@sleepy-coder/git';
import { detectTestCommand, linkDependencies, runTests, type TestCommand, type TestRunResult } from '../test-runner.js';
import { openWorkspace, type Workspace } from '../workspace.js';
import { gatherContext } from './context.js';
import { applyEdits, parseEdits, type ApplyResult } from './edits.js';
import {
  buildEditMessages,
  buildFixMessages,
  EDIT_SCHEMA,
  type AgentModel,
  type AgentTask,
  type FileSnapshot,
  type FixFeedback,
} from './prompt.js';

export interface ExecuteOptions {
  task: AgentTask;
  /** The user's checkout. Never modified. */
  repoPath: string;
  /** Where the worktree is created (inside Sleepy Coder's data folder). */
  worktreePath: string;
  model: AgentModel;
  /** Test tools detected in the repo, to tell the model which framework to use. */
  testingTools?: string[];
  /**
   * Optional check that the task is really solved, run on the worktree after the changes.
   * Returns a description of the problem if it is still there, or null if it is solved.
   * For tasks found by rules, the server re-runs the same rule here.
   */
  verify?: (worktreePath: string) => Promise<string | null>;
  /** Called with a short message at every step, for progress in the UI. */
  onStep?: (message: string) => void;
  testTimeoutMs?: number;
}

export interface ExecuteOutcome {
  status: 'completed' | 'tests-failed' | 'failed';
  branch: string | null;
  baseCommit: string | null;
  commit: string | null;
  summary: string | null;
  files: FileChange[];
  diff: string | null;
  testsBefore: TestRunResult | null;
  testsAfter: TestRunResult | null;
  error: string | null;
}

function describeRejections(result: ApplyResult): string {
  return result.rejected.map((r) => `${r.path}: ${r.reason}`).join('; ');
}

/**
 * Carries out one approved task:
 * worktree → tests before → model edits → validate & write → check the task is solved
 * (one fix attempt) → tests (one fix attempt) → commit → diff.
 *
 * The user's checkout is never touched. The worktree folder is always removed at the end;
 * the branch is kept only if something was committed.
 */
export async function executeTask(options: ExecuteOptions): Promise<ExecuteOutcome> {
  const { task, repoPath, model } = options;
  const testingTools = options.testingTools ?? [];
  const step = (message: string) => options.onStep?.(message);

  const outcome: ExecuteOutcome = {
    status: 'failed',
    branch: null,
    baseCommit: null,
    commit: null,
    summary: null,
    files: [],
    diff: null,
    testsBefore: null,
    testsAfter: null,
    error: null,
  };

  let worktree: TaskWorktree | null = null;

  try {
    step('Creating an isolated worktree');
    worktree = await createTaskWorktree({
      repoPath,
      worktreePath: options.worktreePath,
      branch: agentBranchName(task.title, task.id),
    });
    outcome.branch = worktree.branch;
    outcome.baseCommit = worktree.baseCommit;
    const worktreePath = worktree.path;

    await linkDependencies(repoPath, worktreePath);
    // Read from the user's checkout, never from what the agent writes.
    const testCommand: TestCommand | null = await detectTestCommand(repoPath);
    const runTestsNow = (label: string) => {
      step(label);
      return runTests(worktreePath, testCommand!, { timeoutMs: options.testTimeoutMs });
    };

    if (testCommand) outcome.testsBefore = await runTestsNow(`Running tests before any change (${testCommand.display})`);
    else step('No test script found: changes will not be tested');

    const workspace: Workspace = await openWorkspace(worktreePath);
    const context = await gatherContext(workspace, task);
    if (context.files.length === 0 && context.tooLarge.length > 0) {
      throw new Error(
        `The files of this task are too large for the local model to rewrite safely: ${context.tooLarge.join(', ')}.`,
      );
    }

    step('Asking the model for the changes');
    const first = parseEdits(await model.complete(buildEditMessages(task, context, testingTools), EDIT_SCHEMA));
    outcome.summary = first.summary || null;

    step('Checking and applying the changes');
    const applied = await applyEdits(workspace, first.edits);
    if (applied.written.length === 0) {
      const why = applied.rejected.length > 0 ? ` Rejected: ${describeRejections(applied)}.` : '';
      const said = first.summary ? ` The model said: "${first.summary}"` : '';
      throw new Error(`The model did not produce any valid change.${why}${said}`);
    }
    if (applied.rejected.length > 0) step(`Some changes were rejected: ${describeRejections(applied)}`);

    /** One more model request with feedback. Returns true if it wrote something. */
    const askForFix = async (feedback: FixFeedback): Promise<boolean> => {
      // The files the agent changed, plus the task's own files, as they are now.
      const paths = new Set([...workspace.written, ...context.files.map((f) => f.path)]);
      const files: FileSnapshot[] = [];
      for (const path of paths) {
        try {
          files.push({ path, content: await workspace.readFile(path) });
        } catch {
          // Deleted or unreadable: skip.
        }
      }
      const fix = parseEdits(await model.complete(buildFixMessages(task, files, feedback, testingTools), EDIT_SCHEMA));
      const result = await applyEdits(workspace, fix.edits);
      if (result.rejected.length > 0) step(`Some changes were rejected: ${describeRejections(result)}`);
      if (result.written.length > 0 && fix.summary) outcome.summary = fix.summary;
      return result.written.length > 0;
    };

    // Is the task really solved? (e.g. the duplicate <h1> is gone)
    if (options.verify) {
      step('Checking that the task is solved');
      let problem = await options.verify(worktreePath);
      if (problem) {
        step('The problem is still there: asking the model to fix its change');
        if (await askForFix({ kind: 'check', problem })) problem = await options.verify(worktreePath);
        if (problem) throw new Error(`The change did not solve the task. The check still finds: ${problem}`);
      }
    }

    if (testCommand) {
      outcome.testsAfter = await runTestsNow('Running tests after the changes');

      // One fix attempt, only if the tests passed before (otherwise the failure is not ours).
      const brokeTheTests = !outcome.testsAfter.passed && (outcome.testsBefore?.passed ?? true);
      if (brokeTheTests) {
        step('Tests failed: asking the model to fix its change');
        if (await askForFix({ kind: 'tests', output: outcome.testsAfter.output })) {
          outcome.testsAfter = await runTestsNow('Running tests again');
        } else {
          step('The model could not propose a fix');
        }
      }
    }

    step(`Committing on branch ${worktree.branch}`);
    const message = `Sleepy Coder: ${task.title}\n\n${outcome.summary ?? ''}\n\nTask: ${task.id}`.trim();
    outcome.commit = await commitAllChanges(worktreePath, message);
    if (!outcome.commit) throw new Error('The changes did not modify any file.');

    const diff = await diffSince(worktreePath, worktree.baseCommit);
    outcome.files = diff.files;
    outcome.diff = diff.truncated ? `${diff.patch}\n… (diff truncated)` : diff.patch;

    if (!outcome.testsAfter || outcome.testsAfter.passed) {
      outcome.status = 'completed';
    } else {
      outcome.status = 'tests-failed';
      outcome.error =
        outcome.testsBefore && !outcome.testsBefore.passed
          ? 'Tests were already failing before the change, so the result could not be verified.'
          : 'The change is on its branch, but the tests fail. Review it carefully.';
    }
    step(outcome.status === 'completed' ? 'Done' : 'Done, but the tests fail');
  } catch (error) {
    outcome.status = 'failed';
    outcome.error = error instanceof Error ? error.message : String(error);
    step(`Failed: ${outcome.error}`);
  } finally {
    if (worktree) {
      // The folder is not needed anymore: the result lives on the branch (and in the saved diff).
      await removeTaskWorktree(repoPath, worktree.path).catch(() => undefined);
      if (!outcome.commit) {
        await deleteAgentBranch(repoPath, worktree.branch).catch(() => undefined);
        outcome.branch = null;
      }
    }
  }

  return outcome;
}
