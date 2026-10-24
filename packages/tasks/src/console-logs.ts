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

/** `console.log(` not inside a // comment. Block comments are rare enough to ignore. */
export const CONSOLE_LOG_PATTERN = /\bconsole\.log\s*\(/;

export function consoleLogLines(content: string): number[] {
  const lines: number[] = [];
  content.split('\n').forEach((line, index) => {
    const match = CONSOLE_LOG_PATTERN.exec(line);
    if (!match) return;
    const before = line.slice(0, match.index);
    if (before.includes('//') || /^\s*\*/.test(before)) return;
    lines.push(index + 1);
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
