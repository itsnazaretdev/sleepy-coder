import { readFileSync, renameSync } from 'node:fs';
import type { Repository } from '@sleepy-coder/shared';
import { transaction, type Database } from '../db/database.js';

/** Saved repositories, stored in SQLite. */
export interface RepositoryStore {
  list(): Promise<Repository[]>;
  get(id: string): Promise<Repository | null>;
  add(repository: Repository): Promise<void>;
  /** Returns false if there was nothing to remove. Its tasks are removed too. */
  remove(id: string): Promise<boolean>;
}

interface RepositoryRow {
  id: string;
  name: string;
  path: string;
  added_at: string;
}

const toRepository = (row: RepositoryRow): Repository => ({
  id: row.id,
  name: row.name,
  path: row.path,
  addedAt: row.added_at,
});

export function createSqliteRepositoryStore(db: Database): RepositoryStore {
  const listStmt = db.prepare('SELECT * FROM repositories ORDER BY added_at, name');
  const getStmt = db.prepare('SELECT * FROM repositories WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO repositories (id, name, path, added_at) VALUES (?, ?, ?, ?)');
  const deleteStmt = db.prepare('DELETE FROM repositories WHERE id = ?');

  // node:sqlite is synchronous; the async interface keeps callers independent of that.
  return {
    async list() {
      return (listStmt.all() as unknown as RepositoryRow[]).map(toRepository);
    },
    async get(id) {
      const row = getStmt.get(id) as unknown as RepositoryRow | undefined;
      return row ? toRepository(row) : null;
    },
    async add(repository) {
      insertStmt.run(repository.id, repository.name, repository.path, repository.addedAt);
    },
    async remove(id) {
      return Number(deleteStmt.run(id).changes) > 0;
    },
  };
}

/**
 * One-time import of repositories saved by Phase 3 (data/repositories.json).
 * The file is renamed afterwards so the import never runs twice.
 * Returns how many repositories were imported.
 */
export function importLegacyRepositories(db: Database, jsonPath: string): number {
  let raw: string;
  try {
    raw = readFileSync(jsonPath, 'utf8');
  } catch {
    return 0; // Nothing to import.
  }

  let repositories: Repository[] = [];
  try {
    const parsed = JSON.parse(raw) as { repositories?: Repository[] };
    repositories = Array.isArray(parsed.repositories) ? parsed.repositories : [];
  } catch {
    return 0; // Unreadable file: leave it alone.
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO repositories (id, name, path, added_at) VALUES (?, ?, ?, ?)',
  );
  const imported = transaction(db, () =>
    repositories.reduce((count, r) => count + Number(insert.run(r.id, r.name, r.path, r.addedAt).changes), 0),
  );

  renameSync(jsonPath, `${jsonPath}.imported`);
  return imported;
}
