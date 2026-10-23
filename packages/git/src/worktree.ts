import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { simpleGit } from 'simple-git';

/**
 * Isolated workspaces for the agent.
 *
 * Each task runs in its own `git worktree`: a second checkout of the repository, on a new
 * branch, in a separate folder. The user's folder, branch and uncommitted changes are never
 * touched. Every command here is fixed; only paths and names we generated are passed in.
 */

/** Every branch the agent creates starts with this. The agent refuses to commit anywhere else. */
export const AGENT_BRANCH_PREFIX = 'sleepy/';

/** Commits made by the agent are clearly signed as such. */
const AGENT_IDENTITY = ['-c', 'user.name=Sleepy Coder', '-c', 'user.email=sleepy-coder@localhost'];

const MAX_PATCH_CHARS = 200_000;

export type WorktreeErrorCode = 'no-commits' | 'not-agent-branch';

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;

  constructor(code: WorktreeErrorCode, message: string) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}

/** "Add `alt` text to the logo!" + task id → "sleepy/add-alt-text-to-the-logo-1a2b3c4d". */
export function agentBranchName(title: string, taskId: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const id = taskId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `${AGENT_BRANCH_PREFIX}${slug || 'task'}-${id}`;
}

async function branchExists(repoPath: string, name: string): Promise<boolean> {
  const out = await simpleGit(repoPath).raw(['branch', '--list', name]);
  return out.trim().length > 0;
}

export interface TaskWorktree {
  path: string;
  branch: string;
  /** Commit the branch started from (the user's HEAD at that moment). */
  baseCommit: string;
}

/**
 * Creates a worktree at `worktreePath` on a new branch starting from the current HEAD.
 * If the branch name is taken (e.g. the task ran before), "-2", "-3"… is added.
 */
export async function createTaskWorktree(options: {
  repoPath: string;
  worktreePath: string;
  branch: string;
}): Promise<TaskWorktree> {
  const git = simpleGit(options.repoPath);

  let baseCommit: string;
  try {
    baseCommit = (await git.raw(['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    throw new WorktreeError('no-commits', 'The repository has no commits yet. Make a first commit before running the agent.');
  }
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) {
    throw new WorktreeError('no-commits', 'The repository has no commits yet. Make a first commit before running the agent.');
  }

  let branch = options.branch;
  for (let n = 2; await branchExists(options.repoPath, branch); n++) {
    branch = `${options.branch}-${n}`;
  }

  await mkdir(dirname(options.worktreePath), { recursive: true });
  await git.raw(['worktree', 'add', '-b', branch, options.worktreePath, baseCommit]);

  return { path: options.worktreePath, branch, baseCommit };
}

/** The branch currently checked out in a folder. */
export async function currentBranch(path: string): Promise<string> {
  return (await simpleGit(path).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

/**
 * Stages every change in the worktree (except node_modules) and commits it.
 * Refuses to run on any branch that is not an agent branch.
 * Repository hooks are skipped (--no-verify): they would run code from the repo.
 * Returns the new commit hash, or null if there was nothing to commit.
 */
export async function commitAllChanges(worktreePath: string, message: string): Promise<string | null> {
  const branch = await currentBranch(worktreePath);
  if (!branch.startsWith(AGENT_BRANCH_PREFIX)) {
    throw new WorktreeError('not-agent-branch', `Refusing to commit on "${branch}": not an agent branch.`);
  }

  const git = simpleGit(worktreePath);
  // node_modules in a worktree are symlinks we created: never commit them.
  await git.raw(['add', '-A', '--', '.', ':(exclude)node_modules', ':(exclude,glob)**/node_modules']);

  const staged = (await git.raw(['diff', '--cached', '--name-only'])).trim();
  if (!staged) return null;

  await git.raw([...AGENT_IDENTITY, 'commit', '--no-verify', '-m', message]);
  return (await git.raw(['rev-parse', 'HEAD'])).trim();
}

export interface FileChange {
  path: string;
  /** null for binary files. */
  additions: number | null;
  deletions: number | null;
}

export interface WorktreeDiff {
  files: FileChange[];
  patch: string;
  /** True if the patch was cut because it was too long. */
  truncated: boolean;
}

/** Everything that changed on the agent branch since `baseCommit`. */
export async function diffSince(worktreePath: string, baseCommit: string): Promise<WorktreeDiff> {
  const git = simpleGit(worktreePath);
  const numstat = await git.raw(['diff', '--numstat', baseCommit, 'HEAD']);
  const patch = await git.raw(['diff', baseCommit, 'HEAD']);

  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split('\t');
      return {
        path: rest.join('\t'),
        additions: added === '-' ? null : Number(added),
        deletions: deleted === '-' ? null : Number(deleted),
      };
    });

  const truncated = patch.length > MAX_PATCH_CHARS;
  return { files, patch: truncated ? patch.slice(0, MAX_PATCH_CHARS) : patch, truncated };
}

/**
 * Deletes an agent branch (used when a run produced no commit, so the branch is empty).
 * Refuses any branch that is not an agent branch.
 */
export async function deleteAgentBranch(repoPath: string, branch: string): Promise<void> {
  if (!branch.startsWith(AGENT_BRANCH_PREFIX)) {
    throw new WorktreeError('not-agent-branch', `Refusing to delete "${branch}": not an agent branch.`);
  }
  await simpleGit(repoPath).raw(['branch', '-D', branch]);
}

/**
 * Deletes the worktree folder. The branch (and its commit) is kept, so the result
 * can still be reviewed, merged or deleted by the user.
 */
export async function removeTaskWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const git = simpleGit(repoPath);
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath]);
  } finally {
    await git.raw(['worktree', 'prune']);
  }
}
