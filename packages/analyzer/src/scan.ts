import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Directories that are generated, installed or tool-specific. Never scanned. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.astro',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vercel',
  'vendor',
  'target',
  '.gradle',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
]);

const IGNORED_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db']);

export interface ScannedFile {
  /** Path relative to the root, always with "/" separators. */
  path: string;
  size: number;
}

export interface ScanResult {
  files: ScannedFile[];
  truncated: boolean;
}

export interface ScanOptions {
  /** Stop after this many files (protects against huge repos). */
  maxFiles?: number;
  /** Do not go deeper than this many directory levels. */
  maxDepth?: number;
}

export const DEFAULT_MAX_FILES = 20_000;
export const DEFAULT_MAX_DEPTH = 20;

/**
 * Recursively lists the files under `root`.
 * - Skips IGNORED_DIRS and symlinks (so the scan never leaves the repository).
 * - Silently skips folders it cannot read.
 * - Output order is deterministic (alphabetical per directory).
 */
export async function scanDirectory(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const files: ScannedFile[] = [];
  let truncated = false;

  async function walk(dir: string, relative: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) return;

      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || depth >= maxDepth) continue;
        await walk(fullPath, relPath, depth + 1);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        const size = await stat(fullPath).then(
          (s) => s.size,
          () => 0,
        );
        files.push({ path: relPath, size });
      }
    }
  }

  await walk(root, '', 0);
  return { files, truncated };
}
