import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AddRepositoryRequest, ApiError } from '@sleepy-coder/shared';
import {
  addRepository,
  analyzeRepository,
  removeRepository,
  RepositoryError,
  type RepositoryDeps,
  type RepositoryErrorCode,
} from '../services/repositories.js';

const STATUS_BY_CODE: Record<RepositoryErrorCode, number> = {
  'invalid-path': 422,
  'not-found': 422,
  'not-a-directory': 422,
  'not-a-git-repo': 422,
  'already-added': 409,
  'repository-not-found': 404,
};

const addBodySchema = {
  type: 'object',
  required: ['path'],
  additionalProperties: false,
  properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-f0-9]{12}$' } },
} as const;

export async function repositoryRoutes(app: FastifyInstance, deps: RepositoryDeps): Promise<void> {
  app.get('/repositories', () => deps.store.list());

  app.post<{ Body: AddRepositoryRequest }>(
    '/repositories',
    { schema: { body: addBodySchema } },
    async (request, reply) => {
      try {
        const repository = await addRepository(request.body.path, deps);
        return reply.code(201).send(repository);
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/repositories/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      try {
        await removeRepository(request.params.id, deps);
        return reply.code(204).send();
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/repositories/:id/analysis',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      try {
        return await analyzeRepository(request.params.id, deps);
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );
}

function handleError(error: unknown, reply: FastifyReply) {
  if (!(error instanceof RepositoryError)) throw error;
  const body: ApiError = { error: error.code, message: error.message };
  return reply.code(STATUS_BY_CODE[error.code]).send(body);
}
