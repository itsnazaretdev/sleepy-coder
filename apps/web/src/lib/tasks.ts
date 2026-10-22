import type { Task, TaskCategory, TaskComplexity, TaskLevel, TaskStatus } from '@sleepy-coder/shared';

/** Spanish labels for the task fields shown in the UI. */

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  todo: 'TODO',
  tests: 'Tests',
  documentation: 'Documentación',
  refactor: 'Refactor',
  maintenance: 'Mantenimiento',
};

export const LEVEL_LABELS: Record<TaskLevel, string> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
};

export const COMPLEXITY_LABELS: Record<TaskComplexity, string> = {
  small: 'pequeña',
  medium: 'media',
  large: 'grande',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pendientes',
  approved: 'Aprobadas',
  discarded: 'Descartadas',
};

export const STATUS_ORDER: TaskStatus[] = ['pending', 'approved', 'discarded'];

export function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { pending: 0, approved: 0, discarded: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

/** Replaces one task in the list (after it changed status), keeping the order. */
export function replaceTask(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => (task.id === updated.id ? updated : task));
}

/** Short sentence describing what a hunt changed. */
export function describeHunt(added: number, removed: number): string {
  if (added === 0 && removed === 0) return 'No hay tareas nuevas.';
  const parts: string[] = [];
  if (added > 0) parts.push(added === 1 ? '1 tarea nueva' : `${added} tareas nuevas`);
  if (removed > 0) parts.push(removed === 1 ? '1 ya resuelta' : `${removed} ya resueltas`);
  return `${parts.join(' · ')}.`;
}
