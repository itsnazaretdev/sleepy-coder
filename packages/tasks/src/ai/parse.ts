import type { TaskCategory, TaskComplexity, TaskDraft, TaskLevel } from '@sleepy-coder/shared';
import { AI_CATEGORIES, MAX_AI_TASKS } from './prompt.js';

/** The model's answer could not be understood at all. */
export class AiOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiOutputError';
  }
}

const LEVELS: readonly TaskLevel[] = ['low', 'medium', 'high'];
const COMPLEXITIES: readonly TaskComplexity[] = ['small', 'medium', 'large'];
const MAX_FILES_PER_TASK = 5;

/** "Fix the Café menu!" → "fix the cafe menu" — used to compare titles. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = asString(value).toLowerCase();
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

/** Strips ```json fences some models add even when asked for raw JSON. */
function stripFences(raw: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim());
  return match ? (match[1] ?? '') : raw.trim();
}

export interface ParseOptions {
  /** Every source path in the repository: files the model invents are dropped. */
  knownFiles: Set<string>;
  /** Titles of tasks that already exist; similar suggestions are skipped. */
  knownTitles?: string[];
}

export interface ParseResult {
  drafts: TaskDraft[];
  /** Suggestions dropped because they were invalid or repeated. */
  skipped: number;
}

/**
 * Turns the model's raw answer into safe TaskDrafts.
 * Never trusts the model: every field is checked, unknown values get safe defaults,
 * invented file paths are removed and the number of tasks is capped.
 */
export function parseSuggestions(raw: string, options: ParseOptions): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new AiOutputError('The model did not answer with valid JSON.', { cause: error });
  }

  const items: unknown[] | null = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { tasks?: unknown }).tasks)
      ? (data as { tasks: unknown[] }).tasks
      : null;

  if (!items) throw new AiOutputError('The model answer has no "tasks" list.');

  const seen = new Set((options.knownTitles ?? []).map(normalizeTitle));
  const drafts: TaskDraft[] = [];
  let skipped = 0;

  for (const item of items) {
    if (drafts.length >= MAX_AI_TASKS || !item || typeof item !== 'object') {
      skipped += 1;
      continue;
    }
    const fields = item as Record<string, unknown>;

    const title = asString(fields.title);
    const description = asString(fields.description);
    const key = normalizeTitle(title);

    if (title.length < 5 || title.length > 120 || !description || !key || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    const files = Array.isArray(fields.affectedFiles) ? fields.affectedFiles : [];
    const affectedFiles = [
      ...new Set(
        files
          .map((f) => asString(f).replace(/^\.?\/+/, ''))
          .filter((f) => options.knownFiles.has(f)),
      ),
    ].slice(0, MAX_FILES_PER_TASK);

    drafts.push({
      fingerprint: `ai:${key}`,
      source: 'ai',
      title,
      description,
      category: pick<TaskCategory>(fields.category, AI_CATEGORIES, 'maintenance'),
      priority: pick(fields.priority, LEVELS, 'medium'),
      complexity: pick(fields.complexity, COMPLEXITIES, 'medium'),
      risk: pick(fields.risk, LEVELS, 'medium'),
      affectedFiles,
      suggestedImplementation: asString(fields.suggestedImplementation) || description,
    });
  }

  return { drafts, skipped };
}
