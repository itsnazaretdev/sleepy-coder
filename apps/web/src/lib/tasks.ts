import type { CodeLocation, Task, TaskCategory, TaskComplexity, TaskLevel, TaskStatus } from '@sleepy-coder/shared';

/** Labels for the task fields shown in the UI. */

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  todo: 'TODO',
  tests: 'Tests',
  documentation: 'Documentation',
  refactor: 'Refactor',
  maintenance: 'Maintenance',
  seo: 'SEO & accessibility',
};

export const LEVEL_LABELS: Record<TaskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const COMPLEXITY_LABELS: Record<TaskComplexity, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  done: 'Done',
  discarded: 'Discarded',
};

export const STATUS_ORDER: TaskStatus[] = ['pending', 'approved', 'done', 'discarded'];

export function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { pending: 0, approved: 0, done: 0, discarded: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

/** Replaces one task in the list (after it changed status), keeping the order. */
export function replaceTask(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => (task.id === updated.id ? updated : task));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Short sentence describing what a hunt changed. */
export function describeHunt(added: number, removed: number): string {
  if (added === 0 && removed === 0) return 'No new tasks.';
  const parts: string[] = [];
  if (added > 0) parts.push(plural(added, 'new task', 'new tasks'));
  if (removed > 0) parts.push(`${removed} already resolved`);
  return `${parts.join(' · ')}.`;
}

/** Same as describeHunt, for AI suggestions (old pending suggestions are replaced, not "resolved"). */
export function describeSuggestions(added: number, removed: number): string {
  if (added === 0) return "Gemma didn't find any new improvements this time.";
  const found = `Gemma suggests ${plural(added, 'new task', 'new tasks')}`;
  const replaced = removed > 0 ? ` (replacing ${plural(removed, 'previous suggestion', 'previous suggestions')})` : '';
  return `${found}${replaced}. They are ideas: check them against your code.`;
}

/**
 * Link that opens a file at a line in VS Code: vscode://file/<absolute path>:<line>:<column>.
 * Works on macOS, Linux and Windows (C:\… becomes /C:/…).
 */
export function editorLink(location: Pick<CodeLocation, 'absolutePath' | 'line'>): string {
  let path = location.absolutePath.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  const position = location.line ? `:${location.line}:1` : '';
  return `vscode://file${encodeURI(path)}${position}`;
}

/** Lines of a snippet with their line numbers, marking the line of the problem. */
export function snippetLines(location: Pick<CodeLocation, 'snippet' | 'snippetStart' | 'line'>) {
  if (!location.snippet) return [];
  return location.snippet.split('\n').map((text, index) => {
    const number = location.snippetStart + index;
    return { number, text, highlight: number === location.line };
  });
}
