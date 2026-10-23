import type { FastifyInstance } from 'fastify';
import { getRun, listLatestRuns, startRun, type RunDeps } from '../services/runs.js';
import { domainErrorHandler } from './errors.js';
import { repositoryParams, uuidParams } from './tasks.js';

export async function runRoutes(app: FastifyInstance, deps: RunDeps): Promise<void> {
  app.setErrorHandler(domainErrorHandler);

  /** Starts the agent on an approved task. Answers right away; poll GET /runs/:id for progress. */
  app.post<{ Params: { id: string } }>('/tasks/:id/run', { schema: { params: uuidParams } }, async (request, reply) => {
    const { run } = await startRun(request.params.id, deps);
    return reply.code(202).send(run);
  });

  app.get<{ Params: { id: string } }>('/runs/:id', { schema: { params: uuidParams } }, async (request) =>
    getRun(request.params.id, deps),
  );

  /** The latest run of each task of a repository. */
  app.get<{ Params: { id: string } }>(
    '/repositories/:id/runs',
    { schema: { params: repositoryParams } },
    (request) => listLatestRuns(request.params.id, deps),
  );
}
