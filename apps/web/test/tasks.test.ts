import { describe, expect, it } from 'vitest';
import type { Task } from '@sleepy-coder/shared';
import { countByStatus, describeHunt, describeSuggestions, editorLink, replaceTask, snippetLines } from '../src/lib/tasks';

const task = (id: string, status: Task['status']): Task => ({
  id,
  repositoryId: 'r',
  status,
  fingerprint: id,
  source: 'static',
  title: id,
  description: '',
  category: 'todo',
  priority: 'low',
  complexity: 'small',
  risk: 'low',
  affectedFiles: [],
  suggestedImplementation: '',
  createdAt: '',
  updatedAt: '',
});

describe('countByStatus', () => {
  it('counts every status, including zeros', () => {
    expect(countByStatus([task('a', 'pending'), task('b', 'pending'), task('c', 'approved')])).toEqual({
      pending: 2,
      approved: 1,
      done: 0,
      discarded: 0,
    });
  });
});

describe('editorLink', () => {
  it('opens the file at the line in VS Code', () => {
    expect(editorLink({ absolutePath: '/Users/naza/My Projects/site/src/a.astro', line: 7 })).toBe(
      'vscode://file/Users/naza/My%20Projects/site/src/a.astro:7:1',
    );
    expect(editorLink({ absolutePath: 'C:\\code\\site\\LICENSE', line: null })).toBe('vscode://file/C:/code/site/LICENSE');
  });
});

describe('snippetLines', () => {
  it('numbers the lines and marks the line of the problem', () => {
    expect(snippetLines({ snippet: 'a\nb\nc', snippetStart: 4, line: 5 })).toEqual([
      { number: 4, text: 'a', highlight: false },
      { number: 5, text: 'b', highlight: true },
      { number: 6, text: 'c', highlight: false },
    ]);
    expect(snippetLines({ snippet: '', snippetStart: 1, line: null })).toEqual([]);
  });
});

describe('replaceTask', () => {
  it('replaces the matching task and keeps the order', () => {
    const list = [task('a', 'pending'), task('b', 'pending')];
    const result = replaceTask(list, task('a', 'approved'));

    expect(result.map((t) => [t.id, t.status])).toEqual([
      ['a', 'approved'],
      ['b', 'pending'],
    ]);
  });
});

describe('describeHunt', () => {
  it.each([
    [0, 0, 'No new tasks.'],
    [1, 0, '1 new task.'],
    [3, 0, '3 new tasks.'],
    [2, 1, '2 new tasks · 1 already resolved.'],
    [0, 2, '2 already resolved.'],
  ])('%i added, %i removed → %s', (added, removed, text) => {
    expect(describeHunt(added, removed)).toBe(text);
  });
});

describe('describeSuggestions', () => {
  it.each([
    [0, 2, "Gemma didn't find any new improvements this time."],
    [1, 0, 'Gemma suggests 1 new task. They are ideas: check them against your code.'],
    [3, 1, 'Gemma suggests 3 new tasks (replacing 1 previous suggestion). They are ideas: check them against your code.'],
    [2, 4, 'Gemma suggests 2 new tasks (replacing 4 previous suggestions). They are ideas: check them against your code.'],
  ])('%i added, %i removed → %s', (added, removed, text) => {
    expect(describeSuggestions(added, removed)).toBe(text);
  });
});
