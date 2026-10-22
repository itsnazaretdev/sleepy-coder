import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitInspector } from '../src/index.js';

/**
 * Integration tests: they create real (temporary) Git repositories,
 * so `git` must be installed.
 */

const git = createGitInspector();
let dir = '';

function run(...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Sleepy Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: dir,
    stdio: 'ignore',
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sleepy-git-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isRepositoryRoot', () => {
  it('is false for a plain folder', async () => {
    expect(await git.isRepositoryRoot(dir)).toBe(false);
  });

  it('is true for the root of a repository', async () => {
    run('init', '-b', 'main');
    expect(await git.isRepositoryRoot(dir)).toBe(true);
  });

  it('is false for a subfolder of a repository', async () => {
    run('init', '-b', 'main');
    await mkdir(join(dir, 'src'));
    expect(await git.isRepositoryRoot(join(dir, 'src'))).toBe(false);
  });

  it('is false for a path that does not exist', async () => {
    expect(await git.isRepositoryRoot(join(dir, 'missing'))).toBe(false);
  });
});

describe('getInfo', () => {
  it('handles a repository without commits', async () => {
    run('init', '-b', 'main');
    const info = await git.getInfo(dir);

    expect(info.branch).toBe('main');
    expect(info.lastCommit).toBeNull();
    expect(info.isClean).toBe(true);
    expect(info.remotes).toEqual([]);
  });

  it('reports the last commit and a clean tree', async () => {
    run('init', '-b', 'main');
    await writeFile(join(dir, 'a.txt'), 'hello');
    run('add', '.');
    run('commit', '-m', 'Initial commit');

    const info = await git.getInfo(dir);

    expect(info.isClean).toBe(true);
    expect(info.lastCommit?.message).toBe('Initial commit');
    expect(info.lastCommit?.author).toBe('Sleepy Test');
    expect(Number.isNaN(Date.parse(info.lastCommit?.date ?? ''))).toBe(false);
  });

  it('counts changed and untracked files separately', async () => {
    run('init', '-b', 'main');
    await writeFile(join(dir, 'a.txt'), 'hello');
    run('add', '.');
    run('commit', '-m', 'Initial commit');

    await writeFile(join(dir, 'a.txt'), 'changed');
    await writeFile(join(dir, 'new.txt'), 'new');

    const info = await git.getInfo(dir);

    expect(info.isClean).toBe(false);
    expect(info.changedFiles).toBe(1);
    expect(info.untrackedFiles).toBe(1);
  });

  it('lists remote names', async () => {
    run('init', '-b', 'main');
    run('remote', 'add', 'origin', 'https://example.com/repo.git');

    expect((await git.getInfo(dir)).remotes).toEqual(['origin']);
  });
});
