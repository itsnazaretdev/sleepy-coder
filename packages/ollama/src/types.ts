export interface OllamaModel {
  /** Full name including tag, e.g. "gemma3:4b". */
  name: string;
  sizeBytes: number;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
  /** ISO 8601 timestamp. */
  modifiedAt: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Sampling temperature. Lower = more deterministic. */
  temperature?: number;
  /** Overrides the client timeout for this call (models can be slow to load). */
  timeoutMs?: number;
}

export interface ChatResult {
  model: string;
  content: string;
  /** Total time reported by Ollama, in milliseconds. */
  durationMs: number | null;
}

/** The surface the rest of the app depends on. Easy to fake in tests. */
export interface OllamaClient {
  readonly baseUrl: string;
  getVersion(): Promise<string>;
  listModels(): Promise<OllamaModel[]>;
  chat(request: ChatRequest): Promise<ChatResult>;
}
