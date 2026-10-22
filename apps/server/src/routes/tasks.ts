import type { FastifyInstance } from 'fastify';
import type { ApiError, TaskStatus, UpdateTaskRequest } from '@sleepy-coder/shared';
import { RepositoryError } from '../services/repositories.js';
import { huntTasks, listTasks, TaskNotFoundError, updateTaskStatus, type TaskDeps } from '../services/tasks.js';

const STATUSES = ['pending', 'approved', 'discarded'] as const;

const repositoryParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-f0-9]{12}$' } },
} as const;

const taskParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } },
} as const;

export async function taskRoutes(app: FastifyInstance, deps: TaskDeps): Promise<void> {
  // Turn domain errors into JSON responses for every route in this plugin.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryError) {
      const status = error.code === 'repository-not-found' ? 404 : 422;
      const body: ApiError = { error: error.code, message: error.message };
      return reply.code(status).send(body);
    }
    if (error instanceof TaskNotFoundError) {
      const body: ApiError = { error: 'task-not-found', message: error.message };
      return reply.code(404).send(body);
    }
    return reply.send(error);
  });

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

  app.patch<{ Params: { id: string }; Body: UpdateTaskRequest }>(
    '/tasks/:id',
    {
      schema: {
        params: taskParams,
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
}
