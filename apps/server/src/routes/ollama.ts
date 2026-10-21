import type { FastifyInstance, FastifyReply } from 'fastify';
import { isOllamaError, type OllamaClient, type OllamaErrorCode } from '@sleepy-coder/ollama';
import type { ApiError } from '@sleepy-coder/shared';
import { getOllamaStatus, NoModelError, runOllamaTest } from '../services/ollama.js';

export interface OllamaRoutesOptions {
  client: OllamaClient;
  configuredModel: string | null;
}

const STATUS_BY_CODE: Record<OllamaErrorCode, number> = {
  unreachable: 503,
  timeout: 504,
  'model-not-found': 404,
  'bad-response': 502,
};

export async function ollamaRoutes(app: FastifyInstance, options: OllamaRoutesOptions): Promise<void> {
  const { client, configuredModel } = options;

  app.get('/ollama/status', () => getOllamaStatus(client, configuredModel));

  app.post('/ollama/test', async (_request, reply) => {
    try {
      return await runOllamaTest(client, configuredModel);
    } catch (error) {
      if (error instanceof NoModelError) return sendError(reply, 409, 'no-model', error.message);
      if (isOllamaError(error)) return sendError(reply, STATUS_BY_CODE[error.code], error.code, error.message);
      throw error;
    }
  });
}

function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.code(status).send(body);
}
