import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTestFile, type ScannedFile } from '@sleepy-coder/analyzer';
import type { TaskDraft } from '@sleepy-coder/shared';

/**
 * `console.log` calls left in front-end code (debugging leftovers). Without AI.
 * Only front-end files: in a Node server or a CLI, logging to the console is often intended.
 */

const FRONTEND_EXTENSIONS = ['.astro', '.jsx', '.tsx', '.vue', '.svelte', '.js', '.ts', '.mjs'];
/** Folders where console output is usually on purpose. */
const SKIPPED_FOLDERS = /(^|\/)(server|api|scripts|bin|cli|backend|test|tests|__tests__|e2e)\//i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CONSOLE_TASKS = 10;

/** `console.log(` in code (comments are removed before searching). */
export const CONSOLE_LOG_PATTERN = /\bconsole\.log\s*\(/;

/**
 * Replaces every comment with spaces, keeping line breaks so line numbers stay the same:
 * `// …`, `/* … *\/` (also across lines), `<!-- … -->` and `{/* … *\/}`.
 * Text inside quotes is never taken for a comment ("http://x" or '/* not a comment'); with
 * `blankStrings` its content is replaced with spaces too, so only real code is left.
 */
export function blankComments(content: string, options: { blankStrings?: boolean } = {}): string {
  const out: string[] = [];
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let i = 0;

  while (i < content.length) {
    const char = content[i]!;
    const next = content[i + 1];

    // Strings: copy them whole (a backslash escapes the next character).
    if (char === '"' || char === "'" || char === '`') {
      let j = i + 1;
      while (j < content.length && content[j] !== char) {
        if (content[j] === '\\') j += 1;
        // A normal quote never spans lines: stop at the end of the line (unbalanced quote in text).
        if (char !== '`' && content[j] === '\n') break;
        j += 1;
      }
      const text = content.slice(i, j + 1);
      out.push(options.blankStrings ? char + blank(text.slice(1, -1)) + text.slice(-1) : text);
      i = j + 1;
      continue;
    }

    let end = -1;
    if (char === '/' && next === '/') {
      end = content.indexOf('\n', i);
      if (end === -1) end = content.length;
    } else if (char === '/' && next === '*') {
      end = content.indexOf('*/', i + 2);
      end = end === -1 ? content.length : end + 2;
    } else if (content.startsWith('<!--', i)) {
      end = content.indexOf('-->', i + 4);
      end = end === -1 ? content.length : end + 3;
    }

    if (end !== -1) {
      out.push(blank(content.slice(i, end)));
      i = end;
      continue;
    }

    out.push(char);
    i += 1;
  }

  return out.join('');
}

export function consoleLogLines(content: string): number[] {
  const lines: number[] = [];
  blankComments(content, { blankStrings: true })
    .split('\n')
    .forEach((line, index) => {
      if (CONSOLE_LOG_PATTERN.test(line)) lines.push(index + 1);
    });
  return lines;
}

const isFrontendFile = (path: string) =>
  FRONTEND_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext)) &&
  /(^|\/)src\//.test(path) &&
  !SKIPPED_FOLDERS.test(path) &&
  !isTestFile(path) &&
  !/\.config\.[cm]?[jt]s$/.test(path) &&
  !/\.d\.ts$/.test(path);

export async function findConsoleLogs(root: string, scanned: ScannedFile[]): Promise<TaskDraft[]> {
  const tasks: TaskDraft[] = [];

  for (const file of scanned) {
    if (!isFrontendFile(file.path) || file.size > MAX_FILE_BYTES) continue;
    let content: string;
    try {
      content = await readFile(join(root, file.path), 'utf8');
    } catch {
      continue;
    }

    const lines = consoleLogLines(content);
    if (lines.length === 0) continue;

    const name = file.path.split('/').pop()!;
    tasks.push({
      fingerprint: `code:console-log:${file.path}`,
      source: 'static',
      title: `Remove ${lines.length === 1 ? 'a' : lines.length} leftover \`console.log\` in \`${name}\``,
      description: `\`${file.path}\` calls \`console.log\` ${lines.length === 1 ? 'once' : `${lines.length} times`} (line${lines.length === 1 ? '' : 's'} ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? '…' : ''}). Debug output left in front-end code fills the visitor's console.`,
      category: 'maintenance',
      priority: 'low',
      complexity: 'small',
      risk: 'low',
      affectedFiles: [file.path],
      suggestedImplementation:
        'Delete the calls that were only for debugging. If one is useful, change it to `console.warn` or `console.error` so it is clearly on purpose.',
    });
    if (tasks.length >= MAX_CONSOLE_TASKS) break;
  }

  return tasks;
}
