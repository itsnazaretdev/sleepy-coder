import { huntStaticTasks } from '@sleepy-coder/tasks';
import type { HuntResponse, Task, TaskStatus } from '@sleepy-coder/shared';
import type { TaskStore } from '../store/tasks.js';
import { RepositoryError, resolveRepositoryPath, type RepositoryDeps } from './repositories.js';

export interface TaskDeps extends RepositoryDeps {
  tasks: TaskStore;
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown task: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

async function requireRepository(id: string, deps: TaskDeps) {
  const repository = await deps.store.get(id);
  if (!repository) throw new RepositoryError('repository-not-found', `Unknown repository: ${id}`);
  return repository;
}

export async function listTasks(repositoryId: string, status: TaskStatus | undefined, deps: TaskDeps): Promise<Task[]> {
  await requireRepository(repositoryId, deps);
  return deps.tasks.list(repositoryId, status);
}

/** Looks for tasks without AI and saves them. Approved and discarded tasks are never touched. */
export async function huntTasks(repositoryId: string, deps: TaskDeps): Promise<HuntResponse> {
  const repository = await requireRepository(repositoryId, deps);
  // The folder may have been moved or deleted since it was added.
  await resolveRepositoryPath(repository.path, deps);

  const { drafts } = await huntStaticTasks(repository.path);
  const { added, removed } = deps.tasks.sync(repositoryId, 'static', drafts);

  return { tasks: deps.tasks.list(repositoryId), added, removed };
}

export function updateTaskStatus(id: string, status: TaskStatus, deps: TaskDeps): Task {
  const task = deps.tasks.updateStatus(id, status);
  if (!task) throw new TaskNotFoundError(id);
  return task;
}
