import type { RunStatus, TaskRun } from '@sleepy-coder/shared';

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Done',
  'tests-failed': 'Tests failing',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

/** Latest run of each task, by task id. */
export function runsByTask(runs: TaskRun[]): Map<string, TaskRun> {
  const map = new Map<string, TaskRun>();
  for (const run of runs) {
    const current = map.get(run.taskId);
    if (!current || run.startedAt > current.startedAt) map.set(run.taskId, run);
  }
  return map;
}

export type DiffLineKind = 'added' | 'removed' | 'hunk' | 'meta' | 'context';

/** Classifies a line of a unified diff, to color it. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'meta';
  }
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  return 'context';
}

/** "Last step" text shown while a run is in progress. */
export function lastStep(run: TaskRun): string {
  return run.steps.at(-1)?.message ?? 'Starting…';
}
