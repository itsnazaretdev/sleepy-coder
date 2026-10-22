import type { FastifyInstance, FastifyReply } from 'fastify';
import { isOllamaError, type OllamaErrorCode } from '@sleepy-coder/ollama';
import { AiOutputError } from '@sleepy-coder/tasks';
import type { ApiError, TaskStatus, UpdateTaskRequest } from '@sleepy-coder/shared';
import { NoModelError } from '../services/ollama.js';
import { RepositoryError } from '../services/repositories.js';
import {
  huntTasks,
  listTasks,
  suggestAiTasks,
  SuggestionBusyError,
  TaskNotFoundError,
  updateTaskStatus,
  type SuggestDeps,
} from '../services/tasks.js';

const STATUSES = ['pending', 'approved', 'discarded'] as const;

const OLLAMA_STATUS: Record<OllamaErrorCode, number> = {
  unreachable: 503,
  timeout: 504,
  'model-not-found': 404,
  'bad-response': 502,
};

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

function send(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.code(status).send(body);
}

export async function taskRoutes(app: FastifyInstance, deps: SuggestDeps): Promise<void> {
  // Turn domain errors into JSON responses for every route in this plugin.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryError) {
      return send(reply, error.code === 'repository-not-found' ? 404 : 422, error.code, error.message);
    }
    if (error instanceof TaskNotFoundError) return send(reply, 404, 'task-not-found', error.message);
    if (error instanceof NoModelError) return send(reply, 409, 'no-model', error.message);
    if (error instanceof SuggestionBusyError) return send(reply, 409, 'ai-busy', error.message);
    if (error instanceof AiOutputError) return send(reply, 502, 'ai-invalid-output', error.message);
    if (isOllamaError(error)) return send(reply, OLLAMA_STATUS[error.code], error.code, error.message);
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

  app.post<{ Params: { id: string } }>(
    '/repositories/:id/tasks/suggest',
    { schema: { params: repositoryParams } },
    (request) => suggestAiTasks(request.params.id, deps),
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
