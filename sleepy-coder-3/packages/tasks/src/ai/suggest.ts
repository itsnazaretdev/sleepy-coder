import { analyzeScan, scanDirectory } from '@sleepy-coder/analyzer';
import type { TaskDraft } from '@sleepy-coder/shared';
import { buildRepositoryContext, type ContextOptions } from './context.js';
import { parseSuggestions } from './parse.js';
import { buildSuggestionMessages, SUGGESTION_SCHEMA, type ModelMessage } from './prompt.js';

/**
 * Anything that can answer a chat with JSON. The server plugs Ollama in here;
 * tests plug in a fake. Keeps this package independent of any LLM provider.
 */
export interface TaskModel {
  complete(messages: ModelMessage[], schema: Record<string, unknown>): Promise<string>;
}

export interface SuggestOptions {
  /** Titles of tasks that already exist, so the model does not repeat them. */
  knownTitles?: string[];
  context?: ContextOptions;
}

export interface SuggestResult {
  drafts: TaskDraft[];
  skipped: number;
}

/** Asks the model for improvement tasks for the repository at `root`. Read-only. */
export async function suggestTasks(root: string, model: TaskModel, options: SuggestOptions = {}): Promise<SuggestResult> {
  const scan = await scanDirectory(root);
  const structure = await analyzeScan(root, scan);
  const context = await buildRepositoryContext(root, scan.files, options.context);

  // Nothing to read: do not bother the model.
  if (context.excerpts.length === 0) return { drafts: [], skipped: 0 };

  const messages = buildSuggestionMessages(structure, context, options.knownTitles ?? []);
  const raw = await model.complete(messages, SUGGESTION_SCHEMA);

  return parseSuggestions(raw, { knownFiles: context.knownFiles, knownTitles: options.knownTitles });
}
