export type OllamaErrorCode =
  /** Ollama is not running or the URL is wrong. */
  | 'unreachable'
  /** Ollama did not answer in time (e.g. a model is still loading). */
  | 'timeout'
  /** The requested model is not installed. */
  | 'model-not-found'
  /** Ollama answered with an error or with something we could not parse. */
  | 'bad-response';

export class OllamaError extends Error {
  readonly code: OllamaErrorCode;

  constructor(code: OllamaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OllamaError';
    this.code = code;
  }
}

export function isOllamaError(error: unknown): error is OllamaError {
  return error instanceof OllamaError;
}
