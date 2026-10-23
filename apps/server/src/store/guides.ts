import type { CodeSuggestion, FixGuide } from '@sleepy-coder/shared';
import type { Database } from '../db/database.js';

/** The latest fix guide of each task. Asking again replaces it. */
export interface GuideStore {
  get(taskId: string): FixGuide | null;
  save(guide: FixGuide): FixGuide;
}

interface GuideRow {
  task_id: string;
  applies: number;
  explanation: string;
  steps: string;
  suggestions: string;
  model: string;
  created_at: string;
}

const toGuide = (row: GuideRow): FixGuide => ({
  taskId: row.task_id,
  applies: row.applies !== 0,
  explanation: row.explanation,
  steps: JSON.parse(row.steps) as string[],
  suggestions: JSON.parse(row.suggestions) as CodeSuggestion[],
  model: row.model,
  createdAt: row.created_at,
});

export function createSqliteGuideStore(db: Database): GuideStore {
  const getOne = db.prepare('SELECT * FROM task_guides WHERE task_id = ?');
  const upsert = db.prepare(`
    INSERT INTO task_guides (task_id, applies, explanation, steps, suggestions, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (task_id) DO UPDATE SET
      applies = excluded.applies, explanation = excluded.explanation, steps = excluded.steps, suggestions = excluded.suggestions,
      model = excluded.model, created_at = excluded.created_at
  `);

  return {
    get(taskId) {
      const row = getOne.get(taskId) as unknown as GuideRow | undefined;
      return row ? toGuide(row) : null;
    },
    save(guide) {
      upsert.run(
        guide.taskId,
        guide.applies ? 1 : 0,
        guide.explanation,
        JSON.stringify(guide.steps),
        JSON.stringify(guide.suggestions),
        guide.model,
        guide.createdAt,
      );
      return guide;
    },
  };
}
