import { describe, expect, it } from 'vitest';
import type { TaskRun } from '@sleepy-coder/shared';
import { diffLineKind, lastStep, runsByTask } from '../src/lib/runs';

const run = (id: string, taskId: string, startedAt: string, steps: string[] = []): TaskRun => ({
  id,
  taskId,
  repositoryId: 'r',
  status: 'completed',
  branch: null,
  baseCommit: null,
  commit: null,
  summary: null,
  files: [],
  diff: null,
  testsBefore: null,
  testsAfter: null,
  steps: steps.map((message) => ({ at: startedAt, message })),
  error: null,
  startedAt,
  finishedAt: null,
});

describe('runsByTask', () => {
  it('keeps the latest run of each task', () => {
    const map = runsByTask([
      run('a', 't1', '2026-10-22T10:00:00Z'),
      run('b', 't1', '2026-10-22T11:00:00Z'),
      run('c', 't2', '2026-10-22T09:00:00Z'),
    ]);
    expect(map.get('t1')?.id).toBe('b');
    expect(map.get('t2')?.id).toBe('c');
  });
});

describe('diffLineKind', () => {
  it.each([
    ['diff --git a/x b/x', 'meta'],
    ['index 123..456 100644', 'meta'],
    ['--- a/math.js', 'meta'],
    ['+++ b/math.js', 'meta'],
    ['@@ -1,3 +1,4 @@', 'hunk'],
    ['+/** Adds two numbers. */', 'added'],
    ['-  return a - b;', 'removed'],
    ['   return a + b;', 'context'],
  ])('%s → %s', (line, kind) => {
    expect(diffLineKind(line)).toBe(kind);
  });
});

describe('lastStep', () => {
  it('shows the latest step, or a placeholder at the very start', () => {
    expect(lastStep(run('a', 't', '2026-10-22T10:00:00Z', ['Creating an isolated worktree', 'Running tests']))).toBe(
      'Running tests',
    );
    expect(lastStep(run('a', 't', '2026-10-22T10:00:00Z'))).toBe('Starting…');
  });
});
