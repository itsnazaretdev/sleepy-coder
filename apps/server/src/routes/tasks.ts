import type { FastifyInstance } from 'fastify';
import type { TaskStatus, UpdateTaskRequest } from '@sleepy-coder/shared';
import { checkTask, createTaskGuide, getTaskGuide, type GuideDeps } from '../services/guides.js';
import { huntTasks, listTasks, suggestAiTasks, updateTaskStatus } from '../services/tasks.js';
import { domainErrorHandler } from './errors.js';

const STATUSES = ['pending', 'approved', 'done', 'discarded'] as const;

export const repositoryParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-f0-9]{12}$' } },
} as const;

export const uuidParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } },
} as const;

export async function taskRoutes(app: FastifyInstance, deps: GuideDeps): Promise<void> {
  // Turn domain errors into JSON responses for every route in this plugin.
  app.setErrorHandler(domainErrorHandler);

  app.get<{ Params: { id: string }; Querystring: { status?: TaskStatus } }>(
    '/repositories/:id/tasks',
    {
      schema: {
        params: repositoryParams,
        querystring: {
          type: 'object',
          properties: { status: { type: 'string', enum: STATUSES } },
        },
      },
    },
    (request) => listTasks(request.params.id, request.query.status, deps),
  );

  app.post<{ Params: { id: string } }>(
    '/repositories/:id/tasks/hunt',
    { schema: { params: repositoryParams } },
    (request) => huntTasks(request.params.id, deps),
  );

  app.post<{ Params: { id: string } }>(
    '/repositories/:id/tasks/suggest',
    { schema: { params: repositoryParams } },
    (request) => suggestAiTasks(request.params.id, deps),
  );

  app.patch<{ Params: { id: string }; Body: UpdateTaskRequest }>(
    '/tasks/:id',
    {
      schema: {
        params: uuidParams,
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { type: 'string', enum: STATUSES } },
        },
      },
    },
    async (request) => updateTaskStatus(request.params.id, request.body.status, deps),
  );

  /** Where the problem is (no AI) and the last fix guide, if any. */
  app.get<{ Params: { id: string } }>('/tasks/:id/guide', { schema: { params: uuidParams } }, (request) =>
    getTaskGuide(request.params.id, deps),
  );

  /** Asks the local model how to fix the task. Slow; nothing is written to the repository. */
  app.post<{ Params: { id: string } }>('/tasks/:id/guide', { schema: { params: uuidParams } }, (request) =>
    createTaskGuide(request.params.id, deps),
  );

  /** Runs the rules again: if the problem is gone, the task becomes "done". */
  app.post<{ Params: { id: string } }>('/tasks/:id/check', { schema: { params: uuidParams } }, (request) =>
    checkTask(request.params.id, deps),
  );
}
