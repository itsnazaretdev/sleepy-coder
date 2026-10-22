import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, OllamaStatusResponse, OllamaTestResponse } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { clientHeaders } from './client-headers.js';
import { fakeOllama, model } from './fake-ollama.js';

const installed = [model('qwen2.5:3b'), model('gemma3:4b')];

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function appWith(fake: ReturnType<typeof fakeOllama>, configuredModel: string | null = null) {
  app = await buildApp({ ollama: fake.client, config: { model: configuredModel } });
  return app;
}

describe('GET /ollama/status', () => {
  it('reports a running Ollama and auto-selects Gemma', async () => {
    const server = await appWith(fakeOllama({ models: installed }));
    const response = await server.inject({ method: 'GET', url: '/ollama/status' });

    expect(response.statusCode).toBe(200);
    const body = response.json<OllamaStatusResponse>();
    expect(body).toMatchObject({
      running: true,
      version: '0.35.1',
      selectedModel: 'gemma3:4b',
      selectedModelAvailable: true,
      selectionSource: 'auto',
    });
    if (body.running) expect(body.models).toHaveLength(2);
  });

  it('respects the configured model', async () => {
    const server = await appWith(fakeOllama({ models: installed }), 'qwen2.5:3b');
    const body = (await server.inject({ method: 'GET', url: '/ollama/status' })).json<OllamaStatusResponse>();

    expect(body).toMatchObject({ selectedModel: 'qwen2.5:3b', selectionSource: 'configured' });
  });

  it('flags a configured model that is not installed', async () => {
    const server = await appWith(fakeOllama({ models: installed }), 'mistral:7b');
    const body = (await server.inject({ method: 'GET', url: '/ollama/status' })).json<OllamaStatusResponse>();

    expect(body).toMatchObject({ selectedModel: 'mistral:7b', selectedModelAvailable: false });
  });

  it('returns 200 with running=false when Ollama is off', async () => {
    const server = await appWith(fakeOllama({ failWith: 'unreachable' }));
    const response = await server.inject({ method: 'GET', url: '/ollama/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json<OllamaStatusResponse>()).toMatchObject({ running: false, errorCode: 'unreachable' });
  });
});

describe('POST /ollama/test', () => {
  it('sends the prompt to the selected model and returns its reply', async () => {
    const fake = fakeOllama({ models: installed, reply: '¡Sí, listo!' });
    const server = await appWith(fake);
    const response = await server.inject({ method: 'POST', headers: clientHeaders, url: '/ollama/test' });

    expect(response.statusCode).toBe(200);
    expect(response.json<OllamaTestResponse>()).toEqual({
      model: 'gemma3:4b',
      reply: '¡Sí, listo!',
      durationMs: 850,
    });
    expect(fake.chatCalls).toEqual(['gemma3:4b']);
  });

  it('returns 409 when no models are installed', async () => {
    const server = await appWith(fakeOllama({ models: [] }));
    const response = await server.inject({ method: 'POST', headers: clientHeaders, url: '/ollama/test' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ApiError>().error).toBe('no-model');
  });

  it('returns 409 and does not call chat when the configured model is missing', async () => {
    const fake = fakeOllama({ models: installed });
    const server = await appWith(fake, 'mistral:7b');
    const response = await server.inject({ method: 'POST', headers: clientHeaders, url: '/ollama/test' });

    expect(response.statusCode).toBe(409);
    expect(fake.chatCalls).toEqual([]);
  });

  it.each([
    ['unreachable', 503],
    ['timeout', 504],
    ['model-not-found', 404],
    ['bad-response', 502],
  ] as const)('maps Ollama error "%s" to HTTP %i', async (code, status) => {
    const server = await appWith(fakeOllama({ failWith: code }));
    const response = await server.inject({ method: 'POST', headers: clientHeaders, url: '/ollama/test' });

    expect(response.statusCode).toBe(status);
    expect(response.json<ApiError>().error).toBe(code);
  });
});