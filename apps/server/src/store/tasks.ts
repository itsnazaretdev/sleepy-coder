import { createHash, randomUUID } from 'node:crypto';
import type { Task, TaskDraft, TaskSource, TaskStatus } from '@sleepy-coder/shared';
import { transaction, type Database } from '../db/database.js';

export interface SyncResult {
  added: number;
  removed: number;
}

export interface TaskStore {
  list(repositoryId: string, status?: TaskStatus): Task[];
  get(id: string): Task | null;
  /**
   * Saves the drafts found by a hunt for one source:
   * - new fingerprints are inserted as "pending",
   * - existing ones keep their status (an approved task stays approved),
   *   except static tasks marked "done" that are found again: they go back to "pending",
   * - pending tasks of that source that were not found again are removed.
   */
  sync(repositoryId: string, source: TaskSource, drafts: TaskDraft[]): SyncResult;
  updateStatus(id: string, status: TaskStatus): Task | null;
}

interface TaskRow {
  id: string;
  repository_id: string;
  fingerprint: string;
  source: TaskSource;
  status: TaskStatus;
  title: string;
  description: string;
  category: Task['category'];
  priority: Task['priority'];
  complexity: Task['complexity'];
  risk: Task['risk'];
  affected_files: string;
  suggested_implementation: string;
  created_at: string;
  updated_at: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    fingerprint: row.fingerprint,
    source: row.source,
    status: row.status,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    complexity: row.complexity,
    risk: row.risk,
    affectedFiles: JSON.parse(row.affected_files) as string[],
    suggestedImplementation: row.suggested_implementation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Hunters can produce long keys (TODO text); store a fixed-size hash instead. */
export function hashFingerprint(fingerprint: string): string {
  return createHash('sha1').update(fingerprint).digest('hex');
}

// Most important first, then oldest first.
const ORDER_BY = `
  ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at, title
`;

export function createSqliteTaskStore(db: Database, now: () => Date = () => new Date()): TaskStore {
  const listAll = db.prepare(`SELECT * FROM tasks WHERE repository_id = ? ${ORDER_BY}`);
  const listByStatus = db.prepare(`SELECT * FROM tasks WHERE repository_id = ? AND status = ? ${ORDER_BY}`);
  const getOne = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const fingerprintsFor = db.prepare('SELECT id, fingerprint, status FROM tasks WHERE repository_id = ? AND source = ?');
  const insert = db.prepare(`
    INSERT INTO tasks (
      id, repository_id, fingerprint, source, status, title, description, category,
      priority, complexity, risk, affected_files, suggested_implementation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // A static task marked "done" that a new hunt finds again has come back: review it again.
  const reopen = db.prepare(`UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'done'`);
  // Refreshes the text of tasks that are still waiting for review (e.g. line numbers changed).
  const refreshPending = db.prepare(`
    UPDATE tasks SET title = ?, description = ?, affected_files = ?, suggested_implementation = ?
    WHERE id = ? AND status = 'pending'
  `);
  const deleteOne = db.prepare('DELETE FROM tasks WHERE id = ?');
  const setStatus = db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');

  const store: TaskStore = {
    list(repositoryId, status) {
      const rows = status ? listByStatus.all(repositoryId, status) : listAll.all(repositoryId);
      return (rows as unknown as TaskRow[]).map(toTask);
    },

    get(id) {
      const row = getOne.get(id) as unknown as TaskRow | undefined;
      return row ? toTask(row) : null;
    },

    sync(repositoryId, source, drafts) {
      return transaction(db, () => {
        const existing = new Map(
          (fingerprintsFor.all(repositoryId, source) as unknown as Array<Pick<TaskRow, 'id' | 'fingerprint' | 'status'>>).map(
            (row) => [row.fingerprint, row],
          ),
        );
        const timestamp = now().toISOString();
        const found = new Set<string>();
        let added = 0;

        for (const draft of drafts) {
          const fingerprint = hashFingerprint(draft.fingerprint);
          if (found.has(fingerprint)) continue;
          found.add(fingerprint);

          const files = JSON.stringify(draft.affectedFiles);
          const current = existing.get(fingerprint);

          if (current) {
            if (source === 'static' && current.status === 'done') reopen.run(timestamp, current.id);
            refreshPending.run(draft.title, draft.description, files, draft.suggestedImplementation, current.id);
            continue;
          }

          insert.run(
            randomUUID(),
            repositoryId,
            fingerprint,
            source,
            draft.title,
            draft.description,
            draft.category,
            draft.priority,
            draft.complexity,
            draft.risk,
            files,
            draft.suggestedImplementation,
            timestamp,
            timestamp,
          );
          added += 1;
        }

        let removed = 0;
        for (const [fingerprint, row] of existing) {
          if (!found.has(fingerprint) && row.status === 'pending') {
            deleteOne.run(row.id);
            removed += 1;
          }
        }

        return { added, removed };
      });
    },

    updateStatus(id, status) {
      const changes = Number(setStatus.run(status, now().toISOString(), id).changes);
      return changes > 0 ? store.get(id) : null;
    },
  };

  return store;
}
