import {
  SERVER_URL,
  type ApiError,
  type HealthResponse,
  type OllamaStatusResponse,
  type OllamaTestResponse,
} from '@sleepy-coder/shared';

const DEFAULT_TIMEOUT_MS = 3_000;
/** The first prompt loads the model into memory; give it time. */
const MODEL_TEST_TIMEOUT_MS = 130_000;

/** Error thrown for non-2xx API responses, carrying the backend's error code. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiError> | null;
    throw new ApiRequestError(
      response.status,
      body?.error ?? 'http-error',
      body?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

/** Fetches the backend health status. Throws if the server is down or slow. */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export function fetchOllamaStatus(): Promise<OllamaStatusResponse> {
  return request<OllamaStatusResponse>('/ollama/status', {}, 8_000);
}

export function testOllamaModel(): Promise<OllamaTestResponse> {
  return request<OllamaTestResponse>('/ollama/test', { method: 'POST' }, MODEL_TEST_TIMEOUT_MS);
}
