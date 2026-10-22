import { fileURLToPath } from 'node:url';
import { DEFAULT_OLLAMA_URL } from '@sleepy-coder/ollama';

/** <repo root>/data, resolved from this file so it works from any working directory. */
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

export interface ServerConfig {
  /** Where Ollama is listening. */
  ollamaUrl: string;
  /** Model forced by the user, or null to pick one automatically. */
  model: string | null;
  /** Folder for local data (saved repositories, later the SQLite database). */
  dataDir: string;
}

/**
 * Reads configuration from environment variables.
 *
 *   SLEEPY_OLLAMA_URL   default http://127.0.0.1:11434
 *   SLEEPY_MODEL        e.g. "gemma3:4b" (default: first Gemma model installed)
 *   SLEEPY_DATA_DIR     default <repo root>/data
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    ollamaUrl: env.SLEEPY_OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL,
    model: env.SLEEPY_MODEL?.trim() || null,
    dataDir: env.SLEEPY_DATA_DIR?.trim() || DEFAULT_DATA_DIR,
  };
}
