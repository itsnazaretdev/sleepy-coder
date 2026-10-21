/**
 * Shared types and constants used by both the server and the web app.
 * Keep this package free of runtime dependencies.
 */

/** Backend only listens on loopback: never exposed to the network. */
export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 4317;
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

/** Astro dev server origin, allowed by the backend CORS policy. */
export const WEB_PORT = 4321;
export const WEB_ORIGINS = [
  `http://localhost:${WEB_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
];

export interface HealthResponse {
  status: 'ok';
  service: 'sleepy-coder-server';
  version: string;
  /** Seconds since the server process started. */
  uptime: number;
  /** ISO 8601 timestamp of the response. */
  timestamp: string;
}

// --- Ollama -----------------------------------------------------------------

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
  modifiedAt: string;
}

export type OllamaErrorCode = 'unreachable' | 'timeout' | 'model-not-found' | 'bad-response';

export type OllamaStatusResponse =
  | {
      running: true;
      url: string;
      version: string;
      models: OllamaModelInfo[];
      /** Model Sleepy Coder will use, or null if none is installed. */
      selectedModel: string | null;
      selectedModelAvailable: boolean;
      /** "configured" = set via SLEEPY_MODEL, "auto" = picked automatically. */
      selectionSource: 'configured' | 'auto' | 'none';
    }
  | {
      running: false;
      url: string;
      errorCode: OllamaErrorCode;
      message: string;
    };

export interface OllamaTestResponse {
  model: string;
  reply: string;
  durationMs: number | null;
}

/** Error body returned by the API for failed requests. */
export interface ApiError {
  error: string;
  message: string;
}

// --- Execution --------------------------------------------------------------

export type ExecutionMode = 'observer' | 'assistant' | 'work-session';

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'assistant';
