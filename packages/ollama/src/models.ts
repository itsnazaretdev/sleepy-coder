import type { OllamaModel } from './types.js';

/** Model family used when the user has not configured one. */
export const PREFERRED_FAMILY_PREFIX = 'gemma';

/** Ollama treats "gemma3" and "gemma3:latest" as the same model. */
export function normalizeModelName(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(':') ? trimmed : `${trimmed}:latest`;
}

export interface ModelSelection {
  /** Model that will be used, or null if there is nothing to use. */
  name: string | null;
  /** Whether that model is actually installed. */
  available: boolean;
  /** How it was chosen. */
  source: 'configured' | 'auto' | 'none';
}

/**
 * Decides which model to use.
 * 1. A configured model always wins (even if missing, so the UI can say so).
 * 2. Otherwise the first installed Gemma model.
 * 3. Otherwise the first installed model.
 */
export function selectModel(models: OllamaModel[], configured: string | null): ModelSelection {
  if (configured) {
    const wanted = normalizeModelName(configured);
    const match = models.find((m) => normalizeModelName(m.name) === wanted);
    return { name: match?.name ?? configured, available: Boolean(match), source: 'configured' };
  }

  const preferred = models.find((m) => m.name.toLowerCase().startsWith(PREFERRED_FAMILY_PREFIX));
  const chosen = preferred ?? models[0];

  if (!chosen) return { name: null, available: false, source: 'none' };
  return { name: chosen.name, available: true, source: 'auto' };
}
