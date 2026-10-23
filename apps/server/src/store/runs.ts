import { randomUUID } from 'node:crypto';
import type { RunStatus, RunStep, TaskRun } from '@sleepy-coder/shared';
import type { Database } from '../db/database.js';

export interface RunStore {
  create(taskId: string, repositoryId: string): TaskRun;
  get(id: string): TaskRun | null;
  /** The most recent run of each task of a repository. */
  latestByRepository(repositoryId: string): TaskRun[];
  addStep(id: string, message: string): void;
  update(id: string, fields: Partial<Omit<TaskRun, 'id' | 'taskId' | 'repositoryId' | 'steps' | 'startedAt'>>): TaskRun | null;
  /** Marks every "running" run as "interrupted" (used at startup). Returns them. */
  interruptRunning(): TaskRun[];
}

interface RunRow {
  id: string;
  task_id: string;
  repository_id: string;
  status: RunStatus;
  branch: string | null;
  base_commit: string | null;
  commit_hash: string | null;
  summary: string | null;
  files: string;
  diff: string | null;
  tests_before: string | null;
  tests_after: string | null;
  steps: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const json = <T>(text: string | null, fallback: T): T => (text ? (JSON.parse(text) as T) : fallback);

function toRun(row: RunRow): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    repositoryId: row.repository_id,
    status: row.status,
    branch: row.branch,
    baseCommit: row.base_commit,
    commit: row.commit_hash,
    summary: row.summary,
    files: json(row.files, []),
    diff: row.diff,
    testsBefore: json(row.tests_before, null),
    testsAfter: json(row.tests_after, null),
    steps: json(row.steps, []),
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** TaskRun field → column, and how to store it. */
const COLUMNS: Record<string, { column: string; encode?: (value: unknown) => unknown }> = {
  status: { column: 'status' },
  branch: { column: 'branch' },
  baseCommit: { column: 'base_commit' },
  commit: { column: 'commit_hash' },
  summary: { column: 'summary' },
  files: { column: 'files', encode: (v) => JSON.stringify(v ?? []) },
  diff: { column: 'diff' },
  testsBefore: { column: 'tests_before', encode: (v) => (v ? JSON.stringify(v) : null) },
  testsAfter: { column: 'tests_after', encode: (v) => (v ? JSON.stringify(v) : null) },
  error: { column: 'error' },
  finishedAt: { column: 'finished_at' },
};

export function createSqliteRunStore(db: Database, now: () => Date = () => new Date()): RunStore {
  const insert = db.prepare(
    `INSERT INTO task_runs (id, task_id, repository_id, status, started_at) VALUES (?, ?, ?, 'running', ?)`,
  );
  const getOne = db.prepare('SELECT * FROM task_runs WHERE id = ?');
  const latest = db.prepare(`
    SELECT r.* FROM task_runs r
    WHERE r.repository_id = ?
      AND r.started_at = (SELECT MAX(started_at) FROM task_runs WHERE task_id = r.task_id)
    ORDER BY r.started_at DESC
  `);
  const setSteps = db.prepare('UPDATE task_runs SET steps = ? WHERE id = ?');
  const running = db.prepare(`SELECT * FROM task_runs WHERE status = 'running'`);

  const store: RunStore = {
    create(taskId, repositoryId) {
      const id = randomUUID();
      insert.run(id, taskId, repositoryId, now().toISOString());
      return store.get(id) as TaskRun;
    },

    get(id) {
      const row = getOne.get(id) as unknown as RunRow | undefined;
      return row ? toRun(row) : null;
    },

    latestByRepository(repositoryId) {
      return (latest.all(repositoryId) as unknown as RunRow[]).map(toRun);
    },

    addStep(id, message) {
      const run = store.get(id);
      if (!run) return;
      const steps: RunStep[] = [...run.steps, { at: now().toISOString(), message }];
      setSteps.run(JSON.stringify(steps), id);
    },

    update(id, fields) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const [key, value] of Object.entries(fields)) {
        const spec = COLUMNS[key];
        if (!spec) continue;
        sets.push(`${spec.column} = ?`);
        values.push((spec.encode ? spec.encode(value) : value) as string | number | null);
      }
      if (sets.length > 0) db.prepare(`UPDATE task_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      return store.get(id);
    },

    interruptRunning() {
      const rows = (running.all() as unknown as RunRow[]).map(toRun);
      for (const run of rows) {
        store.update(run.id, {
          status: 'interrupted',
          error: 'The backend stopped while this run was in progress. Nothing resumes automatically.',
          finishedAt: now().toISOString(),
        });
      }
      return rows;
    },
  };

  return store;
}
