import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeLocation, TaskDraft } from '@sleepy-coder/shared';

/**
 * Finds WHERE a task's problem is, by reading the repository right now (no AI).
 * Rules know exactly what they look for (`<h1>`, `<img>` without alt, a TODO line…),
 * so for static tasks the location is always correct. For AI tasks, the code names the
 * model mentioned (`handleUpload`) are searched in the affected files.
 */

export type LocatableTask = Pick<TaskDraft, 'source' | 'category' | 'title' | 'description' | 'suggestedImplementation' | 'affectedFiles'>;

/** Lines shown before and after the problem. */
export const SNIPPET_CONTEXT = 3;
export const MAX_LOCATIONS = 8;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 512 * 1024;

interface Hit {
  /** 0-based offset in the file. */
  index: number;
  note: string;
}

/** Ranges of HTML and JSX comments, and of the Astro frontmatter: matches inside are not markup. */
function ignoredRanges(path: string, content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of content.matchAll(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  if (path.endsWith('.astro')) {
    const front = /^\s*---\r?\n[\s\S]*?\r?\n---/.exec(content);
    if (front) ranges.push([0, front[0].length]);
  }
  return ranges;
}

function markupHits(path: string, content: string, pattern: RegExp, keep: (tag: string) => boolean, note: string): Hit[] {
  const ignored = ignoredRanges(path, content);
  const hits: Hit[] = [];
  for (const match of content.matchAll(pattern)) {
    if (ignored.some(([start, end]) => match.index >= start && match.index < end)) continue;
    if (keep(match[0])) hits.push({ index: match.index, note });
  }
  return hits;
}

const lineOf = (content: string, index: number) => content.slice(0, index).split('\n').length;

/** Turns a 1-based line into a location with a few lines of context. */
function locationAt(root: string, path: string, content: string, line: number, note: string, context: number): CodeLocation {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  return {
    path,
    absolutePath: join(root, path),
    line,
    exists: true,
    note,
    snippet: lines.slice(start - 1, end).join('\n'),
    snippetStart: start,
  };
}

function wholeFile(root: string, path: string, exists: boolean): CodeLocation {
  return {
    path,
    absolutePath: join(root, path),
    line: null,
    exists,
    note: exists ? 'Related file' : 'File to create',
    snippet: '',
    snippetStart: 1,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Code names written between backticks in the task text, e.g. `handleUpload` or `menu.items`. */
export function codeNames(task: LocatableTask): string[] {
  const text = `${task.title}\n${task.description}\n${task.suggestedImplementation}`;
  const names = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]{3,60})`/g)) {
    const name = match[1]!.trim().replace(/\(\)$/, '');
    // Identifiers only: not file paths, not HTML tags, not sentences.
    if (/^[A-Za-z_$][\w$.]*$/.test(name) && !task.affectedFiles.some((file) => file.endsWith(name))) names.add(name);
  }
  return [...names];
}

/** What to look for in one file. */
function findHits(task: LocatableTask, path: string, content: string): Hit[] {
  const title = task.title;

  if (task.category === 'seo' && title.includes('`<h1>`')) {
    return markupHits(path, content, /<h1(?=[\s>])/gi, () => true, 'Extra `<h1>`');
  }
  if (task.category === 'seo' && title.includes('`alt`')) {
    return markupHits(
      path,
      content,
      /<img\b[^>]*>/gi,
      (tag) => !/\balt\s*=/i.test(tag) && !/\{\s*\.\.\./.test(tag),
      '`<img>` without `alt`',
    );
  }
  if (task.category === 'seo' && title.includes('`lang`')) {
    return markupHits(path, content, /<html\b[^>]*>/gi, (tag) => !/\blang\s*=/i.test(tag), '`<html>` without `lang`');
  }

  if (task.category === 'todo') {
    // Description: "TODO comment in `src/a.ts:12`: "text"."
    const marker = /^(TODO|FIXME|HACK|XXX)\b/.exec(task.description)?.[1];
    const text = /: "(.*)"\.$/.exec(task.description)?.[1];
    const line = Number(/`[^`]+:(\d+)`/.exec(task.description)?.[1]);
    const lines = content.split('\n');

    // The code may have moved since the hunt: look for the comment itself first.
    if (marker) {
      const found = lines.findIndex((l) => l.includes(marker) && (!text || l.includes(text.slice(0, 40))));
      if (found >= 0) return [{ index: lines.slice(0, found).join('\n').length + (found > 0 ? 1 : 0), note: `${marker} comment` }];
    }
    if (line > 0 && line <= lines.length) {
      return [{ index: lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0), note: 'Comment' }];
    }
    return [];
  }

  // Anything else (AI tasks): first place where each code name appears.
  const hits: Hit[] = [];
  for (const name of codeNames(task)) {
    const match = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).exec(content);
    if (match) hits.push({ index: match.index, note: `\`${name}\`` });
  }
  return hits;
}

/** Locations of the problem described by a task, in the repository at `root`. Read-only. */
export async function locateTask(
  root: string,
  task: LocatableTask,
  options: {
    contextLines?: number;
    /**
     * When no exact line is found in an existing file, include its first lines (up to this many
     * characters) as the snippet. Used for the model, so it can check the task against real code.
     */
    wholeFileChars?: number;
  } = {},
): Promise<CodeLocation[]> {
  const context = options.contextLines ?? SNIPPET_CONTEXT;
  const locations: CodeLocation[] = [];

  for (const path of task.affectedFiles.slice(0, MAX_FILES)) {
    // Paths come from the database: never read outside the repository.
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) continue;

    let content: string;
    try {
      content = await readFile(join(root, path), 'utf8');
    } catch {
      locations.push(wholeFile(root, path, false));
      continue;
    }
    if (content.length > MAX_FILE_BYTES) {
      locations.push(wholeFile(root, path, true));
      continue;
    }

    const hits = findHits(task, path, content);
    if (hits.length === 0) {
      const location = wholeFile(root, path, true);
      if (options.wholeFileChars && content.trim()) {
        location.snippet = content.slice(0, options.wholeFileChars).replace(/\r?\n$/, '');
      }
      locations.push(location);
      continue;
    }

    // Two hits on the same line (or very close) share one snippet.
    let lastLine = -Infinity;
    for (const hit of hits.sort((a, b) => a.index - b.index)) {
      const line = lineOf(content, hit.index);
      if (line - lastLine <= context) continue;
      lastLine = line;
      locations.push(locationAt(root, path, content, line, hit.note, context));
    }
  }

  return locations.slice(0, MAX_LOCATIONS);
}
