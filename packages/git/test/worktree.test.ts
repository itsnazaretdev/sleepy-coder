import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentBranchName,
  commitAllChanges,
  createTaskWorktree,
  currentBranch,
  deleteAgentBranch,
  diffSince,
  removeTaskWorktree,
  WorktreeError,
} from '../src/index.js';

/**
 * Integration tests with real (temporary) Git repositories.
 * They check the most important promise of the agent: the user's checkout is never touched.
 */

let sandbox = '';
let repo = '';
let worktrees = '';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Naza', '-c', 'user.email=naza@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorktreeError);
  return (error as WorktreeError).code;
}

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-worktree-')));
  repo = join(sandbox, 'repo');
  worktrees = join(sandbox, 'data', 'worktrees');
  await mkdir(repo);
  git(repo, 'init', '-b', 'main');
  await writeFile(join(repo, 'index.js'), 'console.log("hi");\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial commit');
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('agentBranchName', () => {
  it('builds a safe, readable branch name with the task id', () => {
    expect(agentBranchName('Add `alt` text to the Logo!', '1a2b3c4d-5e6f-4000-8000-000000000000')).toBe(
      'sleepy/add-alt-text-to-the-logo-1a2b3c4d',
    );
  });

  it('removes accents and limits the length', () => {
    const name = agentBranchName('Añadir validación '.repeat(10), 'abcdef12');
    expect(name).toMatch(/^sleepy\/anadir-validacion-[a-z0-9-]*-abcdef12$/);
    expect(name.length).toBeLessThanOrEqual('sleepy/'.length + 40 + 1 + 8);
  });

  it('falls back to "task" for titles without letters', () => {
    expect(agentBranchName('¡¡!!', 'abcdef12')).toBe('sleepy/task-abcdef12');
  });
});

describe('createTaskWorktree', () => {
  it('creates a separate checkout on a new branch and leaves the user untouched', async () => {
    await writeFile(join(repo, 'wip.txt'), 'my uncommitted work'); // user's own changes
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't1'), branch: 'sleepy/demo-1' });

    expect(wt.branch).toBe('sleepy/demo-1');
    expect(wt.baseCommit).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(await readFile(join(wt.path, 'index.js'), 'utf8')).toContain('hi');
    // The user's checkout keeps its branch and its uncommitted file; the worktree does not get it.
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(join(repo, 'wip.txt'))).toBe(true);
    expect(existsSync(join(wt.path, 'wip.txt'))).toBe(false);
  });

  it('adds a suffix when the branch already exists', async () => {
    await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 'a'), branch: 'sleepy/demo' });
    const second = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 'b'), branch: 'sleepy/demo' });
    expect(second.branch).toBe('sleepy/demo-2');
  });

  it('refuses a repository without commits', async () => {
    const empty = join(sandbox, 'empty');
    await mkdir(empty);
    git(empty, 'init', '-b', 'main');

    expect(await errorCode(createTaskWorktree({ repoPath: empty, worktreePath: join(worktrees, 'x'), branch: 'sleepy/x' }))).toBe(
      'no-commits',
    );
  });
});

describe('commitAllChanges and diffSince', () => {
  it('commits the agent changes on its branch, signed as Sleepy Coder, and reports the diff', async () => {
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't'), branch: 'sleepy/demo' });
    await writeFile(join(wt.path, 'index.js'), 'console.log("hello");\n');
    await writeFile(join(wt.path, 'new.js'), 'export const a = 1;\n');

    const hash = await commitAllChanges(wt.path, 'Sleepy Coder: demo');
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(git(wt.path, 'log', '-1', '--format=%an|%s')).toBe('Sleepy Coder|Sleepy Coder: demo');
    // main did not move.
    expect(git(repo, 'rev-parse', 'main')).toBe(wt.baseCommit);

    const diff = await diffSince(wt.path, wt.baseCommit);
    expect(diff.files).toEqual([
      { path: 'index.js', additions: 1, deletions: 1 },
      { path: 'new.js', additions: 1, deletions: 0 },
    ]);
    expect(diff.patch).toContain('+console.log("hello");');
    expect(diff.truncated).toBe(false);
  });

  it('returns null when there is nothing to commit', async () => {
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't'), branch: 'sleepy/demo' });
    expect(await commitAllChanges(wt.path, 'nothing')).toBeNull();
  });

  it('never commits node_modules symlinks', async () => {
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't'), branch: 'sleepy/demo' });
    await mkdir(join(repo, 'node_modules'));
    await symlink(join(repo, 'node_modules'), join(wt.path, 'node_modules'));
    await mkdir(join(wt.path, 'app'));
    await symlink(join(repo, 'node_modules'), join(wt.path, 'app', 'node_modules'));
    await writeFile(join(wt.path, 'index.js'), 'changed\n');

    await commitAllChanges(wt.path, 'change');
    const committed = git(wt.path, 'show', '--name-only', '--format=', 'HEAD');
    expect(committed).toBe('index.js');
  });

  it('refuses to commit on a branch that is not an agent branch', async () => {
    await writeFile(join(repo, 'index.js'), 'changed\n');
    expect(await errorCode(commitAllChanges(repo, 'oops'))).toBe('not-agent-branch');
    // Nothing was staged or committed in the user's repo.
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
  });
});

describe('deleteAgentBranch', () => {
  it('deletes an agent branch once its worktree is gone', async () => {
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't'), branch: 'sleepy/empty' });
    await removeTaskWorktree(repo, wt.path);
    await deleteAgentBranch(repo, 'sleepy/empty');
    expect(git(repo, 'branch', '--list', 'sleepy/empty')).toBe('');
  });

  it('refuses to delete any other branch', async () => {
    expect(await errorCode(deleteAgentBranch(repo, 'main'))).toBe('not-agent-branch');
    expect(git(repo, 'branch', '--list', 'main')).toContain('main');
  });
});

describe('removeTaskWorktree', () => {
  it('deletes the folder but keeps the branch with its commit', async () => {
    const wt = await createTaskWorktree({ repoPath: repo, worktreePath: join(worktrees, 't'), branch: 'sleepy/demo' });
    await writeFile(join(wt.path, 'index.js'), 'changed\n');
    const hash = await commitAllChanges(wt.path, 'change');

    await removeTaskWorktree(repo, wt.path);

    expect(existsSync(wt.path)).toBe(false);
    expect(git(repo, 'rev-parse', 'sleepy/demo')).toBe(hash);
    expect(await currentBranch(repo)).toBe('main');
  });
});
