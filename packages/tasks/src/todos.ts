import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { languageOf, type ScannedFile } from '@sleepy-coder/analyzer';
import type { TaskDraft, TaskLevel } from '@sleepy-coder/shared';

export type TodoMarker = 'TODO' | 'FIXME' | 'HACK' | 'XXX';

export interface TodoComment {
  path: string;
  /** 1-based line number. */
  line: number;
  marker: TodoMarker;
  text: string;
}

const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TODOS = 200;

/**
 * A marker only counts inside a comment (//, #, /*, *, <!--, --) and in UPPERCASE.
 * Case matters: in Spanish "todo" is an everyday word ("todo bien").
 */
const TODO_PATTERN =
  /(?:\/\/|#|\/\*|^\s*\*|<!--|--)\s*(TODO|FIXME|HACK|XXX)\b(?:\([^)]*\))?\s*[:\-–]?\s*(.*)$/;

// Keeps only the comment: cuts at the closing token ("*/", "-->"), so code after it
// (e.g. "<!-- FIXME: x --></nav>") is not part of the text. Also collapses spaces.
function cleanText(text: string): string {
  return (text.split(/\*\/|-->/)[0] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * True if `prefix` leaves a string literal open, e.g. `const s = '// TODO`.
 * Counts unescaped quotes of each kind: an odd number means we are inside a string.
 */
export function endsInsideString(prefix: string): boolean {
  return ["'", '"', '`'].some((quote) => {
    let count = 0;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === quote && prefix[i - 1] !== '\\') count += 1;
    }
    return count % 2 === 1;
  });
}

/** Finds TODO-style comments in one file's content. */
export function findTodosInText(path: string, content: string): TodoComment[] {
  const todos: TodoComment[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    const match = TODO_PATTERN.exec(lineText);
    if (!match) return;
    // "// TODO" written inside a string (test data, messages…) is not a real comment.
    if (endsInsideString(lineText.slice(0, match.index))) return;
    todos.push({ path, line: index + 1, marker: match[1] as TodoMarker, text: cleanText(match[2] ?? '') });
  });

  return todos;
}

/** Scans the source files (code only, not docs or data) for TODO-style comments. */
export async function findTodos(root: string, files: ScannedFile[]): Promise<{ todos: TodoComment[]; truncated: boolean }> {
  const todos: TodoComment[] = [];

  for (const file of files) {
    if (!languageOf(file.path) || file.size > MAX_FILE_BYTES) continue;

    let content: string;
    try {
      content = await readFile(join(root, file.path), 'utf8');
    } catch {
      continue;
    }

    for (const todo of findTodosInText(file.path, content)) {
      if (todos.length >= MAX_TODOS) return { todos, truncated: true };
      todos.push(todo);
    }
  }

  return { todos, truncated: false };
}

const PRIORITY_BY_MARKER: Record<TodoMarker, TaskLevel> = {
  FIXME: 'high',
  HACK: 'medium',
  XXX: 'medium',
  TODO: 'low',
};

const shorten = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function todoToTask(todo: TodoComment): TaskDraft {
  const where = `${todo.path}:${todo.line}`;
  const quoted = todo.text ? `"${todo.text}"` : 'sin descripción';

  return {
    // Uses the text, not the line, so the task survives code moving up or down.
    // Empty comments fall back to the line to stay unique.
    fingerprint: `todo:${todo.path}:${todo.marker}:${todo.text || `line-${todo.line}`}`,
    source: 'static',
    title: todo.text ? `${todo.marker}: ${shorten(todo.text)}` : `${todo.marker} en ${where}`,
    description: `Comentario ${todo.marker} en ${where}: ${quoted}.`,
    category: 'todo',
    priority: PRIORITY_BY_MARKER[todo.marker],
    complexity: 'small',
    risk: 'low',
    affectedFiles: [todo.path],
    suggestedImplementation:
      'Lee el código alrededor del comentario, haz lo que pide y borra el comentario cuando esté resuelto.',
  };
}
