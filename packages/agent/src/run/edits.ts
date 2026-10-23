import { normalizeRelativePath, WorkspaceError, type Workspace } from '../workspace.js';
import { MAX_CHANGED_FILES } from './prompt.js';

/** The model's answer could not be understood. */
export class AgentOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentOutputError';
  }
}

/**
 * One change proposed by the model, as a search/replace block:
 * - `search` non-empty: replace that exact text (which must appear once in the file);
 * - `search` empty: `replace` is the whole content (to create a new file).
 * Small models are much better at "replace this snippet" than at rewriting a whole file.
 */
export interface ProposedEdit {
  path: string;
  search: string;
  replace: string;
}

export interface ParsedEdits {
  summary: string;
  edits: ProposedEdit[];
}

/** Upper bound on search/replace blocks in one answer. */
export const MAX_EDIT_BLOCKS = 8;

function stripFences(raw: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim());
  return match ? (match[1] ?? '') : raw.trim();
}

/** Parses and sanity-checks the shape of the model's answer. Never trusts it. */
export function parseEdits(raw: string): ParsedEdits {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new AgentOutputError('The model did not answer with valid JSON.', { cause: error });
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { changes?: unknown }).changes)) {
    throw new AgentOutputError('The model answer has no "changes" list.');
  }

  const { summary, changes } = data as { summary?: unknown; changes: unknown[] };
  const edits: ProposedEdit[] = [];

  for (const change of changes.slice(0, MAX_EDIT_BLOCKS)) {
    if (!change || typeof change !== 'object') continue;
    const { path, search, replace, content } = change as Record<string, unknown>;
    if (typeof path !== 'string') continue;

    if (typeof replace === 'string') {
      edits.push({ path, search: typeof search === 'string' ? search : '', replace });
    } else if (typeof content === 'string') {
      // Older "whole file" format: same as an empty search.
      edits.push({ path, search: '', replace: content });
    }
  }

  return { summary: typeof summary === 'string' ? summary.trim() : '', edits };
}

export type ReplaceResult = { ok: true; text: string } | { ok: false; reason: string };

const occurrences = (text: string, part: string) => text.split(part).length - 1;

/**
 * Replaces `search` with `replace` in `text`. The search must match exactly once.
 * If the exact text is not found, it tries again ignoring the indentation of each line
 * (small models often get leading spaces slightly wrong).
 */
export function applySearchReplace(text: string, search: string, replace: string): ReplaceResult {
  const exact = occurrences(text, search);
  if (exact === 1) {
    const at = text.indexOf(search);
    return { ok: true, text: text.slice(0, at) + replace + text.slice(at + search.length) };
  }
  if (exact > 1) {
    return { ok: false, reason: `the text to replace appears ${exact} times; it must be unique (include more lines)` };
  }

  // Fallback: compare line by line, ignoring leading/trailing spaces.
  const wanted = search.split('\n').map((l) => l.trim());
  while (wanted.length > 0 && wanted[0] === '') wanted.shift();
  while (wanted.length > 0 && wanted[wanted.length - 1] === '') wanted.pop();
  if (wanted.length === 0) return { ok: false, reason: 'the text to replace is empty' };

  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((w, j) => lines[i + j]!.trim() === w)) starts.push(i);
  }

  if (starts.length === 0) return { ok: false, reason: 'the text to replace was not found in the file' };
  if (starts.length > 1) {
    return { ok: false, reason: `the text to replace appears ${starts.length} times; it must be unique (include more lines)` };
  }

  const start = starts[0]!;
  // Keep the file's indentation if the replacement came without it.
  const indent = /^\s*/.exec(lines[start]!)?.[0] ?? '';
  const replacement = replace
    .split('\n')
    .map((line, index) => (index === 0 && !/^\s/.test(line) ? indent + line : line))
    .join('\n');

  const result = [...lines.slice(0, start), ...replacement.split('\n'), ...lines.slice(start + wanted.length)];
  return { ok: true, text: result.join('\n') };
}

/**
 * Comments that small models write instead of the real code, e.g. "// ... rest of the code".
 * Writing them would delete the code they stand for.
 */
const PLACEHOLDER =
  /(\/\/|#|\/\*|<!--|\{\/\*)\s*(\.\.\.|…)|(\/\/|#|\/\*|<!--)[^\n]*\b(rest of (the )?(code|file|component)|existing code|remains? (the )?same|unchanged code)\b/i;

/** The file without any whitespace: two versions that only differ in formatting become equal. */
const withoutWhitespace = (text: string) => text.replace(/\s+/g, '');

/** Returns why an edit is unsafe to apply, or null if it looks fine. */
export function unsafeEditReason(oldContent: string | null, newContent: string): string | null {
  if (!newContent.trim()) return 'the new content is empty';
  if (oldContent !== null && withoutWhitespace(oldContent) === withoutWhitespace(newContent)) {
    // Small models sometimes "reformat" a file instead of doing the task.
    return 'it only changes formatting (spaces and line breaks), not what the task asks';
  }
  if (PLACEHOLDER.test(newContent) && !(oldContent && PLACEHOLDER.test(oldContent))) {
    return 'it contains a placeholder like "// ... rest of the code" instead of real code';
  }
  if (oldContent !== null && oldContent.length > 200 && newContent.length < oldContent.length * 0.5) {
    return 'it would delete more than half of the file';
  }
  return null;
}

export interface ApplyResult {
  written: string[];
  rejected: Array<{ path: string; reason: string }>;
}

/**
 * Applies the model's blocks file by file. A file is written only if ALL its blocks apply
 * and the result passes the safety checks; otherwise the whole file is left untouched.
 */
export async function applyEdits(workspace: Workspace, edits: ProposedEdit[]): Promise<ApplyResult> {
  const written: string[] = [];
  const rejected: ApplyResult['rejected'] = [];

  // Group blocks by file, keeping the model's order.
  const byFile = new Map<string, ProposedEdit[]>();
  for (const edit of edits) {
    let path: string;
    try {
      path = normalizeRelativePath(edit.path);
    } catch (error) {
      rejected.push({ path: String(edit.path), reason: (error as Error).message });
      continue;
    }
    if (!byFile.has(path) && byFile.size >= MAX_CHANGED_FILES) {
      rejected.push({ path, reason: `only ${MAX_CHANGED_FILES} files can be changed at once` });
      continue;
    }
    byFile.set(path, [...(byFile.get(path) ?? []), edit]);
  }

  for (const [path, blocks] of byFile) {
    let oldContent: string | null = null;
    try {
      oldContent = await workspace.readFile(path);
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== 'not-found') {
        rejected.push({ path, reason: (error as Error).message });
        continue;
      }
    }

    let current = oldContent;
    let failure: string | null = null;
    for (const block of blocks) {
      if (block.search === '') {
        current = block.replace; // whole content (new file)
        continue;
      }
      if (current === null) {
        failure = 'the file does not exist; to create it, leave "search" empty and put the whole content in "replace"';
        break;
      }
      const result = applySearchReplace(current, block.search, block.replace);
      if (!result.ok) {
        failure = result.reason;
        break;
      }
      current = result.text;
    }

    if (failure) {
      rejected.push({ path, reason: failure });
      continue;
    }
    if (current === null || current === oldContent) continue; // nothing to do

    const reason = unsafeEditReason(oldContent, current);
    if (reason) {
      rejected.push({ path, reason });
      continue;
    }

    try {
      await workspace.writeFile(path, current);
      written.push(path);
    } catch (error) {
      rejected.push({ path, reason: (error as Error).message });
    }
  }

  return { written, rejected };
}
