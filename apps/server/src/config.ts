import { DEFAULT_OLLAMA_URL } from '@sleepy-coder/ollama';

export interface ServerConfig {
  /** Where Ollama is listening. */
  ollamaUrl: string;
  /** Model forced by the user, or null to pick one automatically. */
  model: string | null;
}

/**
 * Reads configuration from environment variables.
 *
 *   SLEEPY_OLLAMA_URL   default http://127.0.0.1:11434
 *   SLEEPY_MODEL        e.g. "qwen2.5:3b" (default: first Gemma model installed)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    ollamaUrl: env.SLEEPY_OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL,
    model: env.SLEEPY_MODEL?.trim() || null,
  };
}
