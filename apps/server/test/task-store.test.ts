import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskDraft } from '@sleepy-coder/shared';
import type { Database } from '../src/db/database.js';
import { createSqliteRepositoryStore } from '../src/store/repositories.js';
import { createSqliteTaskStore, type TaskStore } from '../src/store/tasks.js';
import { memoryDb } from './memory-db.js';

const REPO = 'aaaaaaaaaaaa';

const draft = (key: string, overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  fingerprint: key,
  source: 'static',
  title: `Task ${key}`,
  description: 'desc',
  category: 'todo',
  priority: 'low',
  complexity: 'small',
  risk: 'low',
  affectedFiles: ['a.ts'],
  suggestedImplementation: 'do it',
  ...overrides,
});

let db: Database;
let tasks: TaskStore;
let clock = 0;

beforeEach(async () => {
  db = memoryDb();
  clock = 0;
  // Each call is one second later, so ordering by date is predictable.
  tasks = createSqliteTaskStore(db, () => new Date(Date.UTC(2026, 9, 22, 10, 0, clock++)));
  await createSqliteRepositoryStore(db).add({ id: REPO, name: 'demo', path: '/demo', addedAt: '2026-10-22T10:00:00Z' });
});

describe('TaskStore.sync', () => {
  it('inserts new drafts as pending', () => {
    expect(tasks.sync(REPO, 'static', [draft('a'), draft('b')])).toEqual({ added: 2, removed: 0 });

    const saved = tasks.list(REPO);
    expect(saved.map((t) => [t.title, t.status])).toEqual([
      ['Task a', 'pending'],
      ['Task b', 'pending'],
    ]);
    expect(saved[0]?.affectedFiles).toEqual(['a.ts']);
  });

  it('does not duplicate tasks on a second hunt', () => {
    tasks.sync(REPO, 'static', [draft('a')]);
    expect(tasks.sync(REPO, 'static', [draft('a')])).toEqual({ added: 0, removed: 0 });
    expect(tasks.list(REPO)).toHaveLength(1);
  });

  it('keeps approved and discarded tasks even when they are no longer found', () => {
    tasks.sync(REPO, 'static', [draft('a'), draft('b'), draft('c')]);
    const [a, b] = tasks.list(REPO);
    tasks.updateStatus(a!.id, 'approved');
    tasks.updateStatus(b!.id, 'discarded');

    expect(tasks.sync(REPO, 'static', [])).toEqual({ added: 0, removed: 1 });
    expect(tasks.list(REPO).map((t) => t.status).sort()).toEqual(['approved', 'discarded']);
  });

  it('a discarded task does not come back as pending', () => {
    tasks.sync(REPO, 'static', [draft('a')]);
    const [a] = tasks.list(REPO);
    tasks.updateStatus(a!.id, 'discarded');

    tasks.sync(REPO, 'static', [draft('a')]);
    expect(tasks.list(REPO, 'pending')).toEqual([]);
  });

  it('refreshes the text of pending tasks but not of approved ones', () => {
    tasks.sync(REPO, 'static', [draft('a'), draft('b')]);
    const b = tasks.list(REPO).find((t) => t.title === 'Task b')!;
    tasks.updateStatus(b.id, 'approved');

    tasks.sync(REPO, 'static', [draft('a', { description: 'new' }), draft('b', { description: 'new' })]);

    const byTitle = Object.fromEntries(tasks.list(REPO).map((t) => [t.title, t.description]));
    expect(byTitle).toEqual({ 'Task a': 'new', 'Task b': 'desc' });
  });

  it('only removes tasks of the same source', () => {
    tasks.sync(REPO, 'static', [draft('a')]);
    tasks.sync(REPO, 'ai', [draft('x', { source: 'ai' })]);
    tasks.sync(REPO, 'static', []);

    expect(tasks.list(REPO).map((t) => t.title)).toEqual(['Task x']);
  });

  it('orders by priority, high first', () => {
    tasks.sync(REPO, 'static', [draft('low'), draft('high', { priority: 'high' }), draft('mid', { priority: 'medium' })]);
    expect(tasks.list(REPO).map((t) => t.priority)).toEqual(['high', 'medium', 'low']);
  });
});

describe('TaskStore.updateStatus', () => {
  it('changes the status and the update date', () => {
    tasks.sync(REPO, 'static', [draft('a')]);
    const [before] = tasks.list(REPO);
    const after = tasks.updateStatus(before!.id, 'approved');

    expect(after?.status).toBe('approved');
    expect(after?.updatedAt > before!.updatedAt).toBe(true);
  });

  it('returns null for an unknown id', () => {
    expect(tasks.updateStatus('00000000-0000-4000-8000-000000000000', 'approved')).toBeNull();
  });

  it('filters by status', () => {
    tasks.sync(REPO, 'static', [draft('a'), draft('b')]);
    tasks.updateStatus(tasks.list(REPO)[0]!.id, 'approved');

    expect(tasks.list(REPO, 'approved')).toHaveLength(1);
    expect(tasks.list(REPO, 'pending')).toHaveLength(1);
  });
});

describe('deleting a repository', () => {
  it('deletes its tasks too', async () => {
    tasks.sync(REPO, 'static', [draft('a')]);
    await createSqliteRepositoryStore(db).remove(REPO);
    expect(tasks.list(REPO)).toEqual([]);
  });
});
