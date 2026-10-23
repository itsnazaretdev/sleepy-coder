import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { scanDirectory } from '@sleepy-coder/analyzer';
import { isHiddenPath, protectedReason } from './protected.js';

/**
 * The only door the agent has to the file system.
 *
 * Every path the model sends is treated as hostile: it must be relative, may not contain "..",
 * must stay inside the workspace after resolving symlinks, and must not be protected.
 */

export type WorkspaceErrorCode =
  | 'invalid-path'
  | 'outside-workspace'
  | 'protected-path'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'binary-file';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

export const MAX_READ_BYTES = 100_000;
export const MAX_WRITE_BYTES = 200_000;
export const MAX_LISTED_FILES = 500;

/**
 * Cleans a path sent by the model: "./src//a.ts" → "src/a.ts".
 * Rejects absolute paths, "~", "..", empty paths and control characters.
 */
export function normalizeRelativePath(input: string): string {
  if (typeof input !== 'string') throw new WorkspaceError('invalid-path', 'The path must be a string.');
  if (/[\u0000-\u001f]/.test(input)) throw new WorkspaceError('invalid-path', 'The path contains control characters.');

  const unified = input.trim().replace(/\\/g, '/');
  if (!unified) throw new WorkspaceError('invalid-path', 'The path is empty.');
  if (unified.startsWith('/') || unified.startsWith('~') || /^[a-zA-Z]:/.test(unified)) {
    throw new WorkspaceError('invalid-path', `Use a path relative to the repository, not "${input}".`);
  }

  const segments = unified.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new WorkspaceError('invalid-path', '".." is not allowed in paths.');
  }
  if (segments.length === 0) throw new WorkspaceError('invalid-path', 'The path is empty.');
  return segments.join('/');
}

export interface Workspace {
  /** Real, absolute path of the workspace root. */
  readonly root: string;
  /** Relative paths written during this session. */
  readonly written: ReadonlySet<string>;
  listFiles(): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<{ path: string; created: boolean }>;
}

export async function openWorkspace(rootPath: string): Promise<Workspace> {
  const root = await realpath(rootPath);
  const written = new Set<string>();

  const isInside = (absolute: string) => absolute === root || absolute.startsWith(root + sep);

  /** Real path of the deepest existing ancestor (or the path itself), to catch symlink escapes. */
  async function realAncestor(absolute: string): Promise<string> {
    let current = absolute;
    for (;;) {
      try {
        return await realpath(current);
      } catch {
        const parent = dirname(current);
        if (parent === current) return current;
        current = parent;
      }
    }
  }

  async function resolveInside(relative: string): Promise<string> {
    const absolute = join(root, relative);
    if (!isInside(absolute) || !isInside(await realAncestor(absolute))) {
      throw new WorkspaceError('outside-workspace', `"${relative}" points outside the repository.`);
    }
    return absolute;
  }

  return {
    root,
    written,

    async listFiles() {
      const { files } = await scanDirectory(root, { maxFiles: 5_000 });
      return files.map((f) => f.path).slice(0, MAX_LISTED_FILES);
    },

    async readFile(path) {
      const relative = normalizeRelativePath(path);
      if (isHiddenPath(relative)) {
        throw new WorkspaceError('protected-path', `"${relative}" is off limits.`);
      }
      const absolute = await resolveInside(relative);

      const info = await lstat(absolute).catch(() => null);
      if (!info) throw new WorkspaceError('not-found', `"${relative}" does not exist.`);
      if (info.isSymbolicLink() || !info.isFile()) throw new WorkspaceError('not-a-file', `"${relative}" is not a regular file.`);
      if (info.size > MAX_READ_BYTES) throw new WorkspaceError('too-large', `"${relative}" is too large to read.`);

      const content = await readFile(absolute, 'utf8');
      if (content.includes('\u0000')) throw new WorkspaceError('binary-file', `"${relative}" is not a text file.`);
      return content;
    },

    async writeFile(path, content) {
      const relative = normalizeRelativePath(path);
      const reason = protectedReason(relative);
      if (reason) throw new WorkspaceError('protected-path', `"${relative}" is protected. ${reason}`);
      if (typeof content !== 'string') throw new WorkspaceError('invalid-path', 'The content must be text.');
      if (content.includes('\u0000')) throw new WorkspaceError('binary-file', 'Only text files can be written.');
      if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
        throw new WorkspaceError('too-large', `The content for "${relative}" is too large.`);
      }

      const absolute = await resolveInside(relative);
      const info = await lstat(absolute).catch(() => null);
      if (info && (info.isSymbolicLink() || !info.isFile())) {
        throw new WorkspaceError('not-a-file', `"${relative}" is not a regular file.`);
      }

      await mkdir(dirname(absolute), { recursive: true });
      // Check again now that the folders exist: a symlinked folder must not lead outside.
      if (!isInside(await realpath(dirname(absolute)))) {
        throw new WorkspaceError('outside-workspace', `"${relative}" points outside the repository.`);
      }

      await writeFile(absolute, content, 'utf8');
      written.add(relative);
      return { path: relative, created: info === null };
    },
  };
}
