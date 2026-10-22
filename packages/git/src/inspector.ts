import { CheckRepoActions, simpleGit, type SimpleGit } from 'simple-git';
import type { GitInfo } from '@sleepy-coder/shared';

/**
 * Read-only view of a Git repository.
 * Phase 3 only inspects; branches and worktrees arrive with the Agent Engine (Phase 5).
 */
export interface GitInspector {
  /** True only if `path` is the root folder of a Git repository. */
  isRepositoryRoot(path: string): Promise<boolean>;
  getInfo(path: string): Promise<GitInfo>;
}

const GIT_TIMEOUT_MS = 10_000;

function gitAt(path: string): SimpleGit {
  // No user input ever reaches git arguments: only fixed, read-only commands are used.
  return simpleGit({ baseDir: path, timeout: { block: GIT_TIMEOUT_MS } });
}

export function createGitInspector(): GitInspector {
  return {
    async isRepositoryRoot(path) {
      try {
        return await gitAt(path).checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
      } catch {
        return false;
      }
    },

    async getInfo(path) {
      const git = gitAt(path);

      const [status, log, remotes] = await Promise.all([
        git.status(),
        // `git log` fails in a repository without commits: treat that as "no commits".
        git.log({ maxCount: 1 }).catch(() => null),
        git.getRemotes(false),
      ]);

      const latest = log?.latest ?? null;
      const untrackedFiles = status.not_added.length;

      return {
        branch: status.detached ? null : status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        isClean: status.isClean(),
        changedFiles: status.files.length - untrackedFiles,
        untrackedFiles,
        lastCommit: latest
          ? {
              hash: latest.hash,
              message: latest.message,
              author: latest.author_name,
              date: new Date(latest.date).toISOString(),
            }
          : null,
        remotes: remotes.map((r) => r.name),
      };
    },
  };
}
