import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Local SQLite database using Node's built-in `node:sqlite` (Node 22.13+).
 * No native dependency to install.
 *
 * Schema changes are added as new entries in MIGRATIONS, never by editing old ones.
 * The applied version is stored in `PRAGMA user_version`.
 */

const MIGRATIONS: string[] = [
  // 1 — repositories and tasks
  `
  CREATE TABLE repositories (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    path      TEXT NOT NULL UNIQUE,
    added_at  TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id                        TEXT PRIMARY KEY,
    repository_id             TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    fingerprint               TEXT NOT NULL,
    source                    TEXT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'pending',
    title                     TEXT NOT NULL,
    description               TEXT NOT NULL,
    category                  TEXT NOT NULL,
    priority                  TEXT NOT NULL,
    complexity                TEXT NOT NULL,
    risk                      TEXT NOT NULL,
    affected_files            TEXT NOT NULL,
    suggested_implementation  TEXT NOT NULL,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    UNIQUE (repository_id, fingerprint)
  );

  CREATE INDEX tasks_by_repository ON tasks (repository_id, status);
  `,

  // 2 — agent runs
  `
  CREATE TABLE task_runs (
    id             TEXT PRIMARY KEY,
    task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status         TEXT NOT NULL,
    branch         TEXT,
    base_commit    TEXT,
    commit_hash    TEXT,
    summary        TEXT,
    files          TEXT NOT NULL DEFAULT '[]',
    diff           TEXT,
    tests_before   TEXT,
    tests_after    TEXT,
    steps          TEXT NOT NULL DEFAULT '[]',
    error          TEXT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT
  );

  CREATE INDEX task_runs_by_task ON task_runs (task_id, started_at);
  CREATE INDEX task_runs_by_repository ON task_runs (repository_id, started_at);
  `,

  // 3 — fix guides written by the model (one per task, the latest)
  `
  CREATE TABLE task_guides (
    task_id      TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    explanation  TEXT NOT NULL,
    steps        TEXT NOT NULL DEFAULT '[]',
    suggestions  TEXT NOT NULL DEFAULT '[]',
    model        TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  `,

  // 4 — the model can say a task does not apply (AI suggestions can be wrong)
  `
  ALTER TABLE task_guides ADD COLUMN applies INTEGER NOT NULL DEFAULT 1;
  `,
];

export type Database = DatabaseSync;

/** Opens (or creates) the database and brings its schema up to date. Use ":memory:" in tests. */
export function openDatabase(filePath: string): Database {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (filePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  migrate(db);
  return db;
}

function migrate(db: Database): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;

  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1};`);
    });
  }
}

/** Runs `fn` inside a transaction: everything is saved, or nothing is. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
