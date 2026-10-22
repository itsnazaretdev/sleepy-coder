import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTestFile, languageOf, type ScannedFile } from '@sleepy-coder/analyzer';

/**
 * Chooses what the model gets to read. A 4B model has a small context window,
 * so everything here has a hard character budget.
 */

export interface CodeExcerpt {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepositoryContext {
  /** Source file paths shown to the model (a list, not a tree, to keep it short). */
  fileList: string[];
  /** How many source files were left out of fileList. */
  omittedFiles: number;
  excerpts: CodeExcerpt[];
  /** Every source path in the repo, used to validate the files the model mentions. */
  knownFiles: Set<string>;
}

export interface ContextOptions {
  maxListedFiles?: number;
  maxExcerpts?: number;
  /** Max characters per excerpt. */
  maxExcerptChars?: number;
  /** Max characters for all excerpts together. */
  totalBudgetChars?: number;
}

const DEFAULTS: Required<ContextOptions> = {
  maxListedFiles: 120,
  maxExcerpts: 6,
  maxExcerptChars: 2_500,
  totalBudgetChars: 12_000,
};

/** Files bigger than this are probably generated or data; they are not excerpted. */
const MAX_EXCERPT_SOURCE_BYTES = 40_000;

export async function buildRepositoryContext(
  root: string,
  files: ScannedFile[],
  options: ContextOptions = {},
): Promise<RepositoryContext> {
  const opts = { ...DEFAULTS, ...options };
  const sourceFiles = files.filter((f) => languageOf(f.path) !== null);
  const knownFiles = new Set(sourceFiles.map((f) => f.path));

  // Excerpts: the biggest non-test source files, where improvements are most likely.
  const candidates = sourceFiles
    .filter((f) => !isTestFile(f.path) && f.size > 0 && f.size <= MAX_EXCERPT_SOURCE_BYTES)
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  const excerpts: CodeExcerpt[] = [];
  let used = 0;

  for (const file of candidates) {
    if (excerpts.length >= opts.maxExcerpts) break;
    const room = Math.min(opts.maxExcerptChars, opts.totalBudgetChars - used);
    if (room < 300) break; // Not worth sending a tiny scrap.

    let text: string;
    try {
      text = await readFile(join(root, file.path), 'utf8');
    } catch {
      continue;
    }

    const truncated = text.length > room;
    const content = truncated ? text.slice(0, room) : text;
    excerpts.push({ path: file.path, content, truncated });
    used += content.length;
  }

  const listed = sourceFiles.map((f) => f.path).slice(0, opts.maxListedFiles);

  return {
    fileList: listed,
    omittedFiles: sourceFiles.length - listed.length,
    excerpts,
    knownFiles,
  };
}
