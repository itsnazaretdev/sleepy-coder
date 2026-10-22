import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@sleepy-coder/shared';
import { ApiRequestError, fetchTasks, huntTasks, updateTaskStatus } from '../lib/api';
import { describeError } from '../lib/messages';
import {
  CATEGORY_LABELS,
  COMPLEXITY_LABELS,
  countByStatus,
  describeHunt,
  LEVEL_LABELS,
  replaceTask,
  STATUS_LABELS,
  STATUS_ORDER,
} from '../lib/tasks';
import styles from './TaskBoard.module.css';

interface Props {
  repositoryId: string;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; tasks: Task[] };

const OFFLINE_MESSAGE = 'Sin conexión con el backend.';
const errorMessage = (error: unknown) =>
  error instanceof ApiRequestError ? describeError(error.code) : OFFLINE_MESSAGE;

/** React component: tasks of one repository, with hunting and review. */
export default function TaskBoard({ repositoryId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<TaskStatus>('pending');
  const [hunting, setHunting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', tasks: await fetchTasks(repositoryId) });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, [repositoryId]);

  useEffect(() => {
    setTab('pending');
    setNotice(null);
    void load();
  }, [load]);

  const handleHunt = async () => {
    setHunting(true);
    setNotice(null);
    try {
      const result = await huntTasks(repositoryId);
      setState({ kind: 'ready', tasks: result.tasks });
      setNotice(describeHunt(result.added, result.removed));
      setTab('pending');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setHunting(false);
    }
  };

  const changeStatus = async (task: Task, status: TaskStatus) => {
    setUpdatingId(task.id);
    try {
      const updated = await updateTaskStatus(task.id, status);
      setState((current) => (current.kind === 'ready' ? { kind: 'ready', tasks: replaceTask(current.tasks, updated) } : current));
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setUpdatingId(null);
    }
  };

  const tasks = state.kind === 'ready' ? state.tasks : [];
  const counts = countByStatus(tasks);
  const visible = tasks.filter((task) => task.status === tab);

  return (
    <section className={styles.board}>
      <header className={styles.header}>
        <div>
          <h2>Tareas</h2>
          <p className={styles.muted}>Revisa lo que he encontrado y aprueba lo que quieras que haga el agente.</p>
        </div>
        <button type="button" className={styles.primary} onClick={() => void handleHunt()} disabled={hunting}>
          {hunting ? 'Buscando…' : 'Buscar tareas'}
        </button>
      </header>

      {notice && <p className={styles.notice}>{notice}</p>}

      {state.kind === 'loading' && <p className={styles.muted}>Cargando tareas…</p>}
      {state.kind === 'error' && <p className={styles.error}>{state.message}</p>}

      {state.kind === 'ready' && tasks.length === 0 && (
        <div className={styles.empty}>
          <p>Todavía no hay tareas.</p>
          <p className={styles.muted}>
            Pulsa «Buscar tareas»: buscaré comentarios TODO y FIXME y cosas que le falten al repositorio.
          </p>
        </div>
      )}

      {tasks.length > 0 && (
        <>
          <div className={styles.tabs} role="tablist">
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={tab === status}
                className={tab === status ? styles.tabActive : styles.tab}
                onClick={() => setTab(status)}
              >
                {STATUS_LABELS[status]} <span className={styles.count}>{counts[status]}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className={styles.muted}>Nada por aquí.</p>
          ) : (
            <ul className={styles.list}>
              {visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busy={updatingId === task.id}
                  onChange={(status) => void changeStatus(task, status)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

interface TaskCardProps {
  task: Task;
  busy: boolean;
  onChange: (status: TaskStatus) => void;
}

function TaskCard({ task, busy, onChange }: TaskCardProps) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h3>{task.title}</h3>
        <span className={`${styles.priority} ${styles[task.priority]}`}>Prioridad {LEVEL_LABELS[task.priority]}</span>
      </div>

      <p className={styles.description}>{task.description}</p>

      <ul className={styles.meta}>
        <li>{CATEGORY_LABELS[task.category]}</li>
        <li>Complejidad {COMPLEXITY_LABELS[task.complexity]}</li>
        <li>Riesgo {LEVEL_LABELS[task.risk]}</li>
        <li>{task.source === 'ai' ? 'Sugerida por IA' : 'Detectada automáticamente'}</li>
      </ul>

      {task.affectedFiles.length > 0 && (
        <p className={styles.files}>
          {task.affectedFiles.map((file) => (
            <code key={file}>{file}</code>
          ))}
        </p>
      )}

      <details className={styles.suggestion}>
        <summary>Cómo hacerlo</summary>
        <p>{task.suggestedImplementation}</p>
      </details>

      <div className={styles.actions}>
        {task.status !== 'approved' && (
          <button type="button" className={styles.approve} disabled={busy} onClick={() => onChange('approved')}>
            Aprobar
          </button>
        )}
        {task.status !== 'discarded' && (
          <button type="button" className={styles.discard} disabled={busy} onClick={() => onChange('discarded')}>
            Descartar
          </button>
        )}
        {task.status !== 'pending' && (
          <button type="button" className={styles.reset} disabled={busy} onClick={() => onChange('pending')}>
            Volver a pendiente
          </button>
        )}
      </div>
    </li>
  );
}
