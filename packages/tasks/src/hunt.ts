import { analyzeScan, scanDirectory, type ScanOptions } from '@sleepy-coder/analyzer';
import type { TaskDraft } from '@sleepy-coder/shared';
import { findConsoleLogs } from './console-logs.js';
import { findMarkupIssues } from './markup.js';
import { tasksFromStructure } from './report-tasks.js';
import { findTodos, todoToTask } from './todos.js';

export interface StaticHuntResult {
  drafts: TaskDraft[];
  /** True if there were more TODO comments than the limit. */
  todosTruncated: boolean;
}

/**
 * Finds tasks without AI: gaps in the repository (tests, README, LICENSE),
 * SEO/accessibility issues in markup (duplicate <h1>, missing <title> or meta description, images
 * without alt, links without text, target="_blank" without rel, <html> without lang),
 * TODO/FIXME/HACK/XXX comments and leftover console.log in front-end code. Read-only.
 */
export async function huntStaticTasks(root: string, options: ScanOptions = {}): Promise<StaticHuntResult> {
  const scan = await scanDirectory(root, options);
  const structure = await analyzeScan(root, scan);
  const { todos, truncated } = await findTodos(root, scan.files);
  const markup = await findMarkupIssues(root, scan.files);
  const consoleLogs = await findConsoleLogs(root, scan.files);

  const drafts = [...tasksFromStructure(structure), ...markup, ...todos.map(todoToTask), ...consoleLogs];

  // Two identical comments in the same file would share a fingerprint: keep the first.
  const seen = new Set<string>();
  const unique: TaskDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.fingerprint)) continue;
    seen.add(draft.fingerprint);
    unique.push(draft);
  }

  return { drafts: unique, todosTruncated: truncated };
}
