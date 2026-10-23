import type { CodeLocation, CodeSuggestion } from '@sleepy-coder/shared';
import { locateTask, type LocatableTask } from '../locate.js';
import { AiOutputError } from './parse.js';
import type { ModelMessage } from './prompt.js';
import type { TaskModel } from './suggest.js';

/**
 * Fix guide: the model EXPLAINS how to solve a task and suggests code, but changes nothing.
 * The user reads it, copies what makes sense and makes the change in their editor.
 *
 * Why not let the model edit the files? A 4B local model finds and explains problems well,
 * but does not reliably produce exact edits (see ADR-023).
 */

export const MAX_GUIDE_STEPS = 6;
export const MAX_GUIDE_SUGGESTIONS = 3;
const MAX_EXPLANATION_CHARS = 1_500;
const MAX_STEP_CHARS = 300;
const MAX_CODE_CHARS = 4_000;
/** Lines around the problem the model sees (the UI shows fewer). */
const GUIDE_CONTEXT_LINES = 12;
/** For files without an exact line (usually AI tasks), the model sees the file itself, up to this size. */
const GUIDE_WHOLE_FILE_CHARS = 6_000;

export const GUIDE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    applies: { type: 'boolean' },
    explanation: { type: 'string' },
    steps: { type: 'array', maxItems: MAX_GUIDE_STEPS, items: { type: 'string' } },
    suggestions: {
      type: 'array',
      maxItems: MAX_GUIDE_SUGGESTIONS,
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, code: { type: 'string' } },
        required: ['path', 'code'],
      },
    },
  },
  required: ['applies', 'explanation', 'steps', 'suggestions'],
};

const SYSTEM_PROMPT = `You are Sleepy Coder, a patient senior developer helping someone fix a problem in their own repository.
You do not edit files. You explain where the problem is and how to fix it, so the developer can make the change.
You only answer with JSON that matches the given schema.`;

/** "12 | <h1>Title</h1>" — line numbers help the model point at the right place. */
function numbered(location: CodeLocation): string {
  if (!location.exists) return `### ${location.path}\n(this file does not exist yet)`;
  if (!location.snippet) return `### ${location.path}\n(related file, content not available)`;
  const lines = location.snippet.split('\n').map((text, i) => `${String(location.snippetStart + i).padStart(4)} | ${text}`);
  const at = location.line ? ` — problem at line ${location.line}: ${location.note}` : ' — current content';
  return `### ${location.path}${at}\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

export function buildGuideMessages(task: LocatableTask, locations: CodeLocation[]): ModelMessage[] {
  const code = locations.length > 0 ? locations.map(numbered).join('\n\n') : '(no file is linked to this task)';

  const user = `Task: ${task.title}
Description: ${task.description}
Hint: ${task.suggestedImplementation}

Where the problem is (line numbers are not part of the code):
${code}

First, check the task against the code above. Tasks suggested by AI can be wrong: the problem may
not exist (for example, the values it says are empty are already filled in).
- applies: false if the code shown does not have the problem described. Then explain in "explanation" what the
  code actually contains, and return empty "steps" and "suggestions". Otherwise true.

If it applies, write a fix guide:
- explanation: 2–4 sentences. Why this is a problem and what has to change. Be concrete about this code.
- steps: 1–${MAX_GUIDE_STEPS} short steps in order. Name the file and line, e.g. "In \`src/components/Card.astro\` line 12, change …".
- suggestions: the corrected code for the lines that change, at most ${MAX_GUIDE_SUGGESTIONS}. Write only the few lines that change
  (plus one line around them if it helps to find the place), not the whole file, and without line numbers.
  For a file that does not exist yet, write its whole content. If no code is needed, return an empty list.
- Follow the hint: if it says to keep something, do not suggest changing it.
- Wrap code names in backticks, e.g. \`<h1>\` or \`handleUpload\`.
- Answer in English.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function stripFences(raw: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim());
  return match ? (match[1] ?? '') : raw.trim();
}

/** Removes "12 | " prefixes in case the model copied the line numbers. */
function stripLineNumbers(code: string): string {
  const lines = code.split('\n');
  const numberedLines = lines.filter((line) => /^\s*\d+ \| ?/.test(line)).length;
  return numberedLines > 0 && numberedLines >= lines.length / 2 ? lines.map((line) => line.replace(/^\s*\d+ \| ?/, '')).join('\n') : code;
}

/** Removes ``` fences around a code suggestion. */
function stripCodeFence(code: string): string {
  const match = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(code.trim());
  return match ? (match[1] ?? '') : code;
}

export interface ParsedGuide {
  /** False when the model, looking at the real code, says the problem is not there. */
  applies: boolean;
  explanation: string;
  steps: string[];
  suggestions: CodeSuggestion[];
}

/**
 * Checks the model's answer. Never trusts it: lengths are capped and suggestions for files
 * that are not part of the task are dropped.
 */
export function parseGuide(raw: string, allowedPaths: string[]): ParsedGuide {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new AiOutputError('The model did not answer with valid JSON.', { cause: error });
  }
  if (typeof data !== 'object' || data === null) throw new AiOutputError('The model answer is not a JSON object.');
  const record = data as Record<string, unknown>;

  const explanation = clip(asString(record.explanation), MAX_EXPLANATION_CHARS);
  const steps = (Array.isArray(record.steps) ? record.steps : [])
    .map(asString)
    .filter(Boolean)
    .slice(0, MAX_GUIDE_STEPS)
    .map((step) => clip(step, MAX_STEP_CHARS));

  const allowed = new Set(allowedPaths.map((p) => p.replace(/^\.\//, '')));
  const suggestions: CodeSuggestion[] = [];
  for (const item of Array.isArray(record.suggestions) ? record.suggestions : []) {
    if (typeof item !== 'object' || item === null) continue;
    const path = asString((item as Record<string, unknown>).path).replace(/^\.\//, '');
    const code = stripLineNumbers(stripCodeFence(asString((item as Record<string, unknown>).code)));
    // With a single file, a missing or wrong path almost always means that file.
    const target = allowed.has(path) ? path : allowed.size === 1 ? [...allowed][0]! : null;
    if (!target || !code) continue;
    suggestions.push({ path: target, code: clip(code, MAX_CODE_CHARS) });
    if (suggestions.length >= MAX_GUIDE_SUGGESTIONS) break;
  }

  if (!explanation && steps.length === 0) throw new AiOutputError('The model answer has no explanation.');
  // Only an explicit false counts: a missing field means the model did not question the task.
  if (record.applies === false) return { applies: false, explanation, steps: [], suggestions: [] };
  return { applies: true, explanation, steps, suggestions };
}

/** Locates the problem and asks the model to explain how to fix it. Read-only. */
export async function writeFixGuide(root: string, task: LocatableTask, model: TaskModel): Promise<ParsedGuide> {
  const locations = await locateTask(root, task, {
    contextLines: GUIDE_CONTEXT_LINES,
    wholeFileChars: GUIDE_WHOLE_FILE_CHARS,
  });
  const raw = await model.complete(buildGuideMessages(task, locations), GUIDE_SCHEMA);
  return parseGuide(raw, task.affectedFiles);
}
