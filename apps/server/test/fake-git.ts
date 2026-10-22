import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitInspector } from '@sleepy-coder/git';
import type { GitInfo } from '@sleepy-coder/shared';

export const cleanGitInfo: GitInfo = {
  branch: 'main',
  tracking: 'origin/main',
  ahead: 0,
  behind: 0,
  isClean: true,
  changedFiles: 0,
  untrackedFiles: 0,
  lastCommit: { hash: 'abc123', message: 'Initial commit', author: 'Test', date: '2026-10-21T10:00:00.000Z' },
  remotes: ['origin'],
};

/**
 * Fake GitInspector: a folder counts as a repository if it contains a `.git` folder.
 * Avoids running real git in server tests (the git package has its own integration tests).
 */
export function fakeGit(info: Partial<GitInfo> = {}): GitInspector {
  return {
    async isRepositoryRoot(path) {
      return stat(join(path, '.git')).then(
        (s) => s.isDirectory(),
        () => false,
      );
    },
    async getInfo() {
      return { ...cleanGitInfo, ...info };
    },
  };
}
