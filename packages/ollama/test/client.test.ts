import { describe, expect, it } from 'vitest';
import { createOllamaClient, OllamaError } from '../src/index.js';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Builds a fake fetch that records calls and answers with `handler`. */
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function expectOllamaError(promise: Promise<unknown>, code: OllamaError['code']) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OllamaError);
  expect((error as OllamaError).code).toBe(code);
}

describe('createOllamaClient', () => {
  it('strips trailing slashes from the base URL', () => {
    const client = createOllamaClient({ baseUrl: 'http://127.0.0.1:11434///' });
    expect(client.baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('getVersion returns the version string', async () => {
    const { fn, calls } = fakeFetch(() => json({ version: '0.35.1' }));
    const client = createOllamaClient({ fetch: fn });

    await expect(client.getVersion()).resolves.toBe('0.35.1');
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/version');
  });

  it('listModels maps the raw API shape', async () => {
    const { fn } = fakeFetch(() =>
      json({
        models: [
          {
            name: 'gemma3:4b',
            size: 3_338_801_804,
            modified_at: '2026-10-07T10:00:00Z',
            details: { family: 'gemma3', parameter_size: '4.3B', quantization_level: 'Q4_K_M' },
          },
          { name: 'bare-model' },
        ],
      }),
    );
    const client = createOllamaClient({ fetch: fn });

    await expect(client.listModels()).resolves.toEqual([
      {
        name: 'gemma3:4b',
        sizeBytes: 3_338_801_804,
        family: 'gemma3',
        parameterSize: '4.3B',
        quantization: 'Q4_K_M',
        modifiedAt: '2026-10-07T10:00:00Z',
      },
      { name: 'bare-model', sizeBytes: 0, family: null, parameterSize: null, quantization: null, modifiedAt: '' },
    ]);
  });

  it('listModels handles an empty installation', async () => {
    const { fn } = fakeFetch(() => json({ models: [] }));
    await expect(createOllamaClient({ fetch: fn }).listModels()).resolves.toEqual([]);
  });

  it('chat sends a non-streaming request and returns trimmed content', async () => {
    const { fn, calls } = fakeFetch(() =>
      json({
        model: 'gemma3:4b',
        message: { role: 'assistant', content: '  ¡Hola!  \n' },
        total_duration: 1_234_000_000,
      }),
    );
    const client = createOllamaClient({ fetch: fn });

    const result = await client.chat({
      model: 'gemma3:4b',
      messages: [{ role: 'user', content: 'Hola' }],
      temperature: 0.2,
    });

    expect(result).toEqual({ model: 'gemma3:4b', content: '¡Hola!', durationMs: 1234 });

    const call = calls[0];
    expect(call?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      model: 'gemma3:4b',
      messages: [{ role: 'user', content: 'Hola' }],
      stream: false,
      options: { temperature: 0.2 },
    });
  });

  it('chat omits options when no temperature is given', async () => {
    const { fn, calls } = fakeFetch(() => json({ message: { content: 'ok' } }));
    await createOllamaClient({ fetch: fn }).chat({ model: 'm', messages: [] });

    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('options');
  });

  it('reports "unreachable" when the connection fails', async () => {
    const { fn } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expectOllamaError(createOllamaClient({ fetch: fn }).getVersion(), 'unreachable');
  });

  it('reports "timeout" when the request is aborted by the timeout', async () => {
    const { fn } = fakeFetch(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expectOllamaError(createOllamaClient({ fetch: fn }).getVersion(), 'timeout');
  });

  it('reports "model-not-found" for a 404 about a missing model', async () => {
    const { fn } = fakeFetch(() => json({ error: "model 'nope' not found" }, 404));
    const promise = createOllamaClient({ fetch: fn }).chat({ model: 'nope', messages: [] });
    await expectOllamaError(promise, 'model-not-found');
  });

  it('reports "bad-response" for server errors, using Ollama\'s message', async () => {
    const { fn } = fakeFetch(() => json({ error: 'out of memory' }, 500));
    const error = await createOllamaClient({ fetch: fn })
      .listModels()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OllamaError);
    expect((error as OllamaError).code).toBe('bad-response');
    expect((error as OllamaError).message).toBe('out of memory');
  });

  it('reports "bad-response" for invalid JSON', async () => {
    const { fn } = fakeFetch(() => new Response('not json', { status: 200 }));
    await expectOllamaError(createOllamaClient({ fetch: fn }).getVersion(), 'bad-response');
  });
});
