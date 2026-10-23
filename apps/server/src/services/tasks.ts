import type { OllamaClient } from '@sleepy-coder/ollama';
import { huntStaticTasks, suggestTasks, type TaskModel } from '@sleepy-coder/tasks';
import type { HuntResponse, Task, TaskStatus } from '@sleepy-coder/shared';
import type { TaskStore } from '../store/tasks.js';
import { requireModel } from './ollama.js';
import { RepositoryError, resolveRepositoryPath, type RepositoryDeps } from './repositories.js';

export interface TaskDeps extends RepositoryDeps {
  tasks: TaskStore;
}

export interface SuggestDeps extends TaskDeps {
  ollama: OllamaClient;
  configuredModel: string | null;
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown task: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

/** One model request at a time (suggestions or fix guides): the local model is slow and uses a lot of memory. */
export class SuggestionBusyError extends Error {
  constructor() {
    super('The model is already working on another request. Wait for it to finish.');
    this.name = 'SuggestionBusyError';
  }
}

let modelBusy = false;

/** Runs `fn` while holding the model. Throws SuggestionBusyError if it is already in use. */
export async function withModel<T>(fn: () => Promise<T>): Promise<T> {
  if (modelBusy) throw new SuggestionBusyError();
  modelBusy = true;
  try {
    return await fn();
  } finally {
    modelBusy = false;
  }
}

export async function requireRepository(id: string, deps: TaskDeps) {
  const repository = await deps.store.get(id);
  if (!repository) throw new RepositoryError('repository-not-found', `Unknown repository: ${id}`);
  // The folder may have been moved or deleted since it was added.
  await resolveRepositoryPath(repository.path, deps);
  return repository;
}

export async function listTasks(repositoryId: string, status: TaskStatus | undefined, deps: TaskDeps): Promise<Task[]> {
  const repository = await deps.store.get(repositoryId);
  if (!repository) throw new RepositoryError('repository-not-found', `Unknown repository: ${repositoryId}`);
  return deps.tasks.list(repositoryId, status);
}

/** Looks for tasks without AI and saves them. Approved and discarded tasks are never touched. */
export async function huntTasks(repositoryId: string, deps: TaskDeps): Promise<HuntResponse> {
  const repository = await requireRepository(repositoryId, deps);

  const { drafts } = await huntStaticTasks(repository.path);
  const { added, removed } = deps.tasks.sync(repositoryId, 'static', drafts);

  return { tasks: deps.tasks.list(repositoryId), added, removed };
}

/** First load of a model in memory + a long prompt: give it time on a laptop. */
const SUGGESTION_TIMEOUT_MS = 180_000;
/** Enough room for the prompt (~12k characters of code) and the answer. */
const SUGGESTION_CONTEXT_TOKENS = 8_192;

/** Adapts Ollama to the provider-agnostic TaskModel used by the tasks package. */
export function ollamaTaskModel(client: OllamaClient, model: string): TaskModel {
  return {
    async complete(messages, schema) {
      const result = await client.chat({
        model,
        messages,
        format: schema,
        temperature: 0.3,
        numCtx: SUGGESTION_CONTEXT_TOKENS,
        timeoutMs: SUGGESTION_TIMEOUT_MS,
      });
      return result.content;
    },
  };
}

/**
 * Asks the local model for improvement tasks and saves them as source "ai".
 * Pending AI tasks from a previous run are replaced; approved/discarded ones are kept.
 */
export async function suggestAiTasks(repositoryId: string, deps: SuggestDeps): Promise<HuntResponse> {
  return withModel(async () => {
    const repository = await requireRepository(repositoryId, deps);
    const model = await requireModel(deps.ollama, deps.configuredModel);

    // Tell the model what already exists so it does not repeat it:
    // every static task, plus AI tasks the user already approved or discarded.
    const knownTitles = deps.tasks
      .list(repositoryId)
      .filter((task) => task.source === 'static' || task.status !== 'pending')
      .map((task) => task.title);

    const { drafts } = await suggestTasks(repository.path, ollamaTaskModel(deps.ollama, model), { knownTitles });
    const { added, removed } = deps.tasks.sync(repositoryId, 'ai', drafts);

    return { tasks: deps.tasks.list(repositoryId), added, removed };
  });
}

export function updateTaskStatus(id: string, status: TaskStatus, deps: TaskDeps): Task {
  const task = deps.tasks.updateStatus(id, status);
  if (!task) throw new TaskNotFoundError(id);
  return task;
}
