import { OllamaError, type OllamaClient, type OllamaErrorCode, type OllamaModel } from '@sleepy-coder/ollama';

export const model = (name: string): OllamaModel => ({
  name,
  sizeBytes: 1_000,
  family: name.split(':')[0] ?? null,
  parameterSize: null,
  quantization: null,
  modifiedAt: '2026-10-07T10:00:00Z',
});

interface FakeOptions {
  models?: OllamaModel[];
  /** Make every call fail with this error code. */
  failWith?: OllamaErrorCode;
  reply?: string;
}

/** In-memory OllamaClient for tests. Records which models were used in chat. */
export function fakeOllama(options: FakeOptions = {}) {
  const chatCalls: string[] = [];
  const fail = () => {
    if (options.failWith) throw new OllamaError(options.failWith, `fake ${options.failWith}`);
  };

  const client: OllamaClient = {
    baseUrl: 'http://127.0.0.1:11434',
    async getVersion() {
      fail();
      return '0.35.1';
    },
    async listModels() {
      fail();
      return options.models ?? [];
    },
    async chat(req) {
      fail();
      chatCalls.push(req.model);
      return { model: req.model, content: options.reply ?? '¡Listo!', durationMs: 850 };
    },
  };

  return { client, chatCalls };
}
