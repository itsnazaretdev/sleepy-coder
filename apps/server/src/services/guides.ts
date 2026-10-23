import type { CheckTaskResponse, Task, TaskGuideResponse } from '@sleepy-coder/shared';
import { huntStaticTasks, locateTask, writeFixGuide, type TaskModel } from '@sleepy-coder/tasks';
import type { GuideStore } from '../store/guides.js';
import { hashFingerprint } from '../store/tasks.js';
import { requireModel } from './ollama.js';
import { ollamaTaskModel, requireRepository, TaskNotFoundError, withModel, type SuggestDeps } from './tasks.js';

/**
 * Fix guides (ADR-023): Sleepy Coder shows WHERE the problem is (rules, no AI) and the model
 * explains HOW to fix it. The user makes the change; nothing is written to the repository.
 */

export interface GuideDeps extends SuggestDeps {
  guides: GuideStore;
  /** Injected in tests instead of Ollama. */
  guideModel?: TaskModel;
}

/** AI tasks have no rule that can check them: the user marks them as done. */
export class TaskNotCheckableError extends Error {
  constructor() {
    super('Only tasks found by “Find tasks” can be checked automatically. Mark this one as done yourself.');
    this.name = 'TaskNotCheckableError';
  }
}

function requireTask(id: string, deps: GuideDeps): Task {
  const task = deps.tasks.get(id);
  if (!task) throw new TaskNotFoundError(id);
  return task;
}

/** Where the problem is right now, plus the last guide written by the model (if any). Fast, no AI. */
export async function getTaskGuide(taskId: string, deps: GuideDeps): Promise<TaskGuideResponse> {
  const task = requireTask(taskId, deps);
  const repository = await requireRepository(task.repositoryId, deps);
  return {
    task,
    locations: await locateTask(repository.path, task),
    guide: deps.guides.get(task.id),
  };
}

/** Asks the local model to explain how to fix the task, and saves the answer. Read-only for the repo. */
export async function createTaskGuide(taskId: string, deps: GuideDeps): Promise<TaskGuideResponse> {
  const task = requireTask(taskId, deps);
  const repository = await requireRepository(task.repositoryId, deps);

  return withModel(async () => {
    let modelName = 'test-model';
    let model = deps.guideModel;
    if (!model) {
      modelName = await requireModel(deps.ollama, deps.configuredModel);
      model = ollamaTaskModel(deps.ollama, modelName);
    }

    const parsed = await writeFixGuide(repository.path, task, model);
    const guide = deps.guides.save({ taskId: task.id, ...parsed, model: modelName, createdAt: new Date().toISOString() });

    return { task, locations: await locateTask(repository.path, task), guide };
  });
}

/**
 * "Check again": runs the rules on the repository. If they no longer find the task,
 * the user fixed it and the task becomes "done".
 */
export async function checkTask(taskId: string, deps: GuideDeps): Promise<CheckTaskResponse> {
  const task = requireTask(taskId, deps);
  if (task.source !== 'static') throw new TaskNotCheckableError();
  const repository = await requireRepository(task.repositoryId, deps);

  const { drafts } = await huntStaticTasks(repository.path);
  const still = drafts.some((draft) => hashFingerprint(draft.fingerprint) === task.fingerprint);

  if (still) return { task, fixed: false, locations: await locateTask(repository.path, task) };

  const done = deps.tasks.updateStatus(task.id, 'done') ?? task;
  return { task: done, fixed: true, locations: [] };
}
