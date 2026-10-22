import { describe, expect, it } from 'vitest';
import type { Task } from '@sleepy-coder/shared';
import { countByStatus, describeHunt, describeSuggestions, replaceTask } from '../src/lib/tasks';

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
      discarded: 0,
    });
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
    [0, 0, 'No hay tareas nuevas.'],
    [1, 0, '1 tarea nueva.'],
    [3, 0, '3 tareas nuevas.'],
    [2, 1, '2 tareas nuevas · 1 ya resuelta.'],
    [0, 2, '2 ya resueltas.'],
  ])('%i added, %i removed → %s', (added, removed, text) => {
    expect(describeHunt(added, removed)).toBe(text);
  });
});

describe('describeSuggestions', () => {
  it.each([
    [0, 2, 'Gemma no ha encontrado mejoras nuevas esta vez.'],
    [1, 0, 'Gemma sugiere 1 tarea nueva.'],
    [3, 1, 'Gemma sugiere 3 tareas nuevas (sustituyen a 1 sugerencia anterior).'],
    [2, 4, 'Gemma sugiere 2 tareas nuevas (sustituyen a 4 sugerencias anteriores).'],
  ])('%i added, %i removed → %s', (added, removed, text) => {
    expect(describeSuggestions(added, removed)).toBe(text);
  });
});
