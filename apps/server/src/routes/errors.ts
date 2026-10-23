import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { isOllamaError, type OllamaErrorCode } from '@sleepy-coder/ollama';
import { AiOutputError } from '@sleepy-coder/tasks';
import type { ApiError } from '@sleepy-coder/shared';
import { NoModelError } from '../services/ollama.js';
import { RepositoryError } from '../services/repositories.js';
import { TaskNotCheckableError } from '../services/guides.js';
import { AgentBusyError, AgentDisabledError, RunNotFoundError, TaskNotApprovedError } from '../services/runs.js';
import { SuggestionBusyError, TaskNotFoundError } from '../services/tasks.js';

const OLLAMA_STATUS: Record<OllamaErrorCode, number> = {
  unreachable: 503,
  timeout: 504,
  'model-not-found': 404,
  'bad-response': 502,
};

function send(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.code(status).send(body);
}

/** Turns domain errors into JSON API errors. Anything else goes to Fastify's default handler. */
export function domainErrorHandler(error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof RepositoryError) {
    return send(reply, error.code === 'repository-not-found' ? 404 : 422, error.code, error.message);
  }
  if (error instanceof TaskNotFoundError) return send(reply, 404, 'task-not-found', error.message);
  if (error instanceof RunNotFoundError) return send(reply, 404, 'run-not-found', error.message);
  if (error instanceof TaskNotApprovedError) return send(reply, 409, 'task-not-approved', error.message);
  if (error instanceof AgentDisabledError) return send(reply, 403, 'agent-disabled', error.message);
  if (error instanceof TaskNotCheckableError) return send(reply, 409, 'task-not-checkable', error.message);
  if (error instanceof AgentBusyError) return send(reply, 409, 'agent-busy', error.message);
  if (error instanceof NoModelError) return send(reply, 409, 'no-model', error.message);
  if (error instanceof SuggestionBusyError) return send(reply, 409, 'ai-busy', error.message);
  if (error instanceof AiOutputError) return send(reply, 502, 'ai-invalid-output', error.message);
  if (isOllamaError(error)) return send(reply, OLLAMA_STATUS[error.code], error.code, error.message);
  return reply.send(error);
}
