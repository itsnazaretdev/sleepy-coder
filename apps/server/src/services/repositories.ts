import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { analyzeStructure } from '@sleepy-coder/analyzer';
import type { GitInspector } from '@sleepy-coder/git';
import type {
  GitInfo,
  Repository,
  RepositoryReport,
  ReportWarningCode,
  StructureReport,
} from '@sleepy-coder/shared';
import type { RepositoryStore } from '../store/repositories.js';

export type RepositoryErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'not-a-directory'
  | 'not-a-git-repo'
  | 'already-added'
  | 'repository-not-found';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

export interface RepositoryDeps {
  store: RepositoryStore;
  git: GitInspector;
  /** Injected in tests. */
  now?: () => Date;
  homeDir?: string;
}

/** Turns "~/Projects/app" into an absolute path. Other paths are returned trimmed. */
export function expandHome(input: string, home: string = homedir()): string {
  const trimmed = input.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return join(home, trimmed.slice(2));
  return trimmed;
}

/** Short, stable id for a path. The same folder always gets the same id. */
export function repositoryId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12);
}

/**
 * Checks that the input is an absolute path to an existing folder that is the
 * root of a Git repository, and returns its real path (symlinks resolved).
 */
export async function resolveRepositoryPath(input: string, deps: Pick<RepositoryDeps, 'git' | 'homeDir'>) {
  const expanded = expandHome(input, deps.homeDir);

  if (!expanded || !isAbsolute(expanded)) {
    throw new RepositoryError('invalid-path', 'The path must be absolute, e.g. /Users/me/Projects/app');
  }

  let resolved: string;
  try {
    resolved = await realpath(expanded);
  } catch {
    throw new RepositoryError('not-found', `Folder not found: ${expanded}`);
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new RepositoryError('not-a-directory', `Not a folder: ${resolved}`);
  }

  if (!(await deps.git.isRepositoryRoot(resolved))) {
    throw new RepositoryError('not-a-git-repo', `Not the root of a Git repository: ${resolved}`);
  }

  return resolved;
}

export async function addRepository(input: string, deps: RepositoryDeps): Promise<Repository> {
  const path = await resolveRepositoryPath(input, deps);
  const id = repositoryId(path);

  if (await deps.store.get(id)) {
    throw new RepositoryError('already-added', `Repository already added: ${path}`);
  }

  const repository: Repository = {
    id,
    name: basename(path),
    path,
    addedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  await deps.store.add(repository);
  return repository;
}

export async function removeRepository(id: string, deps: RepositoryDeps): Promise<void> {
  if (!(await deps.store.remove(id))) {
    throw new RepositoryError('repository-not-found', `Unknown repository: ${id}`);
  }
}

/** Things worth pointing out to the user. They will feed the Task Hunter (Phase 4). */
export function buildWarnings(structure: StructureReport, git: GitInfo): ReportWarningCode[] {
  const warnings: ReportWarningCode[] = [];
  if (!git.isClean) warnings.push('uncommitted-changes');
  if (structure.files.testFiles === 0) warnings.push('no-tests');
  if (!structure.hasReadme) warnings.push('no-readme');
  if (!structure.hasLicense) warnings.push('no-license');
  if (structure.files.truncated) warnings.push('scan-truncated');
  return warnings;
}

/** Runs a fresh, read-only analysis of a saved repository. */
export async function analyzeRepository(id: string, deps: RepositoryDeps): Promise<RepositoryReport> {
  const repository = await deps.store.get(id);
  if (!repository) {
    throw new RepositoryError('repository-not-found', `Unknown repository: ${id}`);
  }

  // The folder may have been moved or deleted since it was added.
  await resolveRepositoryPath(repository.path, deps);

  const now = deps.now ?? (() => new Date());
  const started = now();

  const [structure, git] = await Promise.all([analyzeStructure(repository.path), deps.git.getInfo(repository.path)]);

  return {
    repository,
    ...structure,
    git,
    warnings: buildWarnings(structure, git),
    analyzedAt: started.toISOString(),
    durationMs: Math.max(0, now().getTime() - started.getTime()),
  };
}
