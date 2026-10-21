import { OllamaError } from './errors.js';
import type { ChatRequest, ChatResult, OllamaClient, OllamaModel } from './types.js';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 5_000;
/** First call to a model loads it into memory, which can take a while on a laptop. */
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

export interface OllamaClientOptions {
  baseUrl?: string;
  /** Timeout for quick calls (version, list). */
  timeoutMs?: number;
  /** Injected for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

// Raw shapes returned by the Ollama REST API (only the fields we use).
interface RawTagsResponse {
  models?: Array<{
    name: string;
    size?: number;
    modified_at?: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface RawChatResponse {
  model?: string;
  message?: { role?: string; content?: string };
  total_duration?: number;
}

export function createOllamaClient(options: OllamaClientOptions = {}): OllamaClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetch ?? globalThis.fetch;

  async function request<T>(path: string, init: RequestInit = {}, timeout = timeoutMs): Promise<T> {
    let response: Response;

    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new OllamaError('timeout', `Ollama did not respond within ${timeout} ms`, { cause: error });
      }
      throw new OllamaError('unreachable', `Could not connect to Ollama at ${baseUrl}`, { cause: error });
    }

    if (!response.ok) {
      const message = await readErrorMessage(response);
      if (response.status === 404 && /not found/i.test(message)) {
        throw new OllamaError('model-not-found', message);
      }
      throw new OllamaError('bad-response', message);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new OllamaError('bad-response', 'Ollama returned invalid JSON', { cause: error });
    }
  }

  return {
    baseUrl,

    async getVersion() {
      const data = await request<{ version?: string }>('/api/version');
      if (typeof data.version !== 'string') {
        throw new OllamaError('bad-response', 'Missing version in Ollama response');
      }
      return data.version;
    },

    async listModels() {
      const data = await request<RawTagsResponse>('/api/tags');
      return (data.models ?? []).map(toModel);
    },

    async chat(req: ChatRequest): Promise<ChatResult> {
      const body = {
        model: req.model,
        messages: req.messages,
        stream: false,
        ...(req.temperature !== undefined && { options: { temperature: req.temperature } }),
      };

      const data = await request<RawChatResponse>(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        req.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
      );

      const content = data.message?.content;
      if (typeof content !== 'string') {
        throw new OllamaError('bad-response', 'Missing message content in Ollama response');
      }

      return {
        model: data.model ?? req.model,
        content: content.trim(),
        // Ollama reports durations in nanoseconds.
        durationMs: typeof data.total_duration === 'number' ? Math.round(data.total_duration / 1e6) : null,
      };
    },
  };
}

function toModel(raw: NonNullable<RawTagsResponse['models']>[number]): OllamaModel {
  return {
    name: raw.name,
    sizeBytes: raw.size ?? 0,
    family: raw.details?.family ?? null,
    parameterSize: raw.details?.parameter_size ?? null,
    quantization: raw.details?.quantization_level ?? null,
    modifiedAt: raw.modified_at ?? '',
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON, fall through.
  }
  return text.trim() || `HTTP ${response.status}`;
}
