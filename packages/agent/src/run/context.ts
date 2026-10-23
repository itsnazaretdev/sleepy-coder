import { isTestFile, languageOf, scanDirectory } from '@sleepy-coder/analyzer';
import type { Workspace } from '../workspace.js';
import type { AgentTask, FileSnapshot } from './prompt.js';

/** Files bigger than this are not given to the model to rewrite: a 4B model would mangle them. */
export const MAX_EDITABLE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 24_000;
const MAX_LISTED = 150;
const MAX_EXAMPLE_TEST_CHARS = 4_000;

export interface AgentContext {
  fileList: string[];
  files: FileSnapshot[];
  /** Affected files that exist but are too big for the model to rewrite. */
  tooLarge: string[];
}

/**
 * Chooses what the model reads:
 * 1. the task's affected files (if they exist and are small enough);
 * 2. if there are none, the biggest source files, as a starting point;
 * 3. for test tasks, one existing test file, so the model copies its style.
 */
export async function gatherContext(workspace: Workspace, task: AgentTask): Promise<AgentContext> {
  const { files: scanned } = await scanDirectory(workspace.root, { maxFiles: 5_000 });
  const sizes = new Map(scanned.map((f) => [f.path, f.size]));
  const fileList = scanned.map((f) => f.path).slice(0, MAX_LISTED);

  const files: FileSnapshot[] = [];
  const tooLarge: string[] = [];
  let used = 0;

  const add = async (path: string, limit = MAX_EDITABLE_CHARS) => {
    if (files.some((f) => f.path === path)) return;
    try {
      const content = await workspace.readFile(path);
      if (content.length > limit) {
        tooLarge.push(path);
        return;
      }
      if (used + content.length > MAX_CONTEXT_CHARS) return;
      files.push({ path, content });
      used += content.length;
    } catch {
      // Missing or not readable: the model may still create it (e.g. LICENSE).
    }
  };

  for (const path of task.affectedFiles) {
    if (sizes.has(path)) await add(path);
  }

  if (files.length === 0 && tooLarge.length === 0) {
    const biggest = scanned
      .filter((f) => languageOf(f.path) && !isTestFile(f.path) && f.size <= MAX_EDITABLE_CHARS)
      .sort((a, b) => b.size - a.size)
      .slice(0, 2);
    for (const file of biggest) await add(file.path);
  }

  if (task.category === 'tests') {
    const example = scanned
      .filter((f) => isTestFile(f.path) && f.size <= MAX_EXAMPLE_TEST_CHARS)
      .sort((a, b) => a.size - b.size)[0];
    if (example) await add(example.path, MAX_EXAMPLE_TEST_CHARS);
  }

  return { fileList, files, tooLarge };
}
