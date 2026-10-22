import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@sleepy-coder/shared';
import { ApiRequestError, fetchTasks, huntTasks, suggestTasks, updateTaskStatus } from '../lib/api';
import { describeError } from '../lib/messages';
import {
  CATEGORY_LABELS,
  COMPLEXITY_LABELS,
  countByStatus,
  describeHunt,
  describeSuggestions,
  LEVEL_LABELS,
  replaceTask,
  STATUS_LABELS,
  STATUS_ORDER,
} from '../lib/tasks';
import InlineText from './InlineText';
import styles from './TaskBoard.module.css';

interface Props {
  repositoryId: string;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; tasks: Task[] };

const OFFLINE_MESSAGE = 'No connection to the backend.';
const errorMessage = (error: unknown) =>
  error instanceof ApiRequestError ? describeError(error.code) : OFFLINE_MESSAGE;

/** React component: tasks of one repository, with hunting and review. */
export default function TaskBoard({ repositoryId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<TaskStatus>('pending');
  /** Which search is running, if any. Only one at a time. */
  const [searching, setSearching] = useState<'none' | 'static' | 'ai'>('none');
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

  const runSearch = async (kind: 'static' | 'ai') => {
    setSearching(kind);
    setNotice(null);
    try {
      const result = kind === 'static' ? await huntTasks(repositoryId) : await suggestTasks(repositoryId);
      setState({ kind: 'ready', tasks: result.tasks });
      setNotice(
        kind === 'static'
          ? describeHunt(result.added, result.removed)
          : describeSuggestions(result.added, result.removed),
      );
      setTab('pending');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSearching('none');
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
          <h2>Tasks</h2>
          <p className={styles.muted}>Review what was found and approve what you want the agent to do.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void runSearch('static')}
            disabled={searching !== 'none'}
          >
            {searching === 'static' ? 'Scanning…' : 'Find tasks'}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void runSearch('ai')}
            disabled={searching !== 'none'}
          >
            {searching === 'ai' ? 'Gemma is thinking…' : 'Suggest with AI'}
          </button>
        </div>
      </header>

      {searching === 'ai' && (
        <p className={styles.thinking}>
          Gemma is reading part of your code. This can take a minute or two, especially the first time.
        </p>
      )}

      {notice && <p className={styles.notice}>{notice}</p>}

      {state.kind === 'loading' && <p className={styles.muted}>Loading tasks…</p>}
      {state.kind === 'error' && <p className={styles.error}>{state.message}</p>}

      {state.kind === 'ready' && tasks.length === 0 && (
        <div className={styles.empty}>
          <p>No tasks yet.</p>
          <p className={styles.muted}>
            “Find tasks” instantly finds TODO and FIXME comments and things the repository is missing, without AI.
            “Suggest with AI” asks Gemma for improvement ideas based on your code.
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
            <p className={styles.muted}>Nothing here.</p>
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
    <li className={task.source === 'ai' ? `${styles.card} ${styles.aiCard}` : styles.card}>
      <div className={styles.cardHead}>
        <h3>
          {task.source === 'ai' && <span className={styles.aiBadge}>AI</span>}
          <InlineText text={task.title} />
        </h3>
        <span className={`${styles.priority} ${styles[task.priority]}`}>{LEVEL_LABELS[task.priority]} priority</span>
      </div>

      <p className={styles.description}>
        <InlineText text={task.description} />
      </p>

      <ul className={styles.meta}>
        <li>{CATEGORY_LABELS[task.category]}</li>
        <li>{COMPLEXITY_LABELS[task.complexity]} complexity</li>
        <li>{LEVEL_LABELS[task.risk]} risk</li>
        <li>{task.source === 'ai' ? 'Suggested by AI' : 'Found automatically'}</li>
      </ul>

      {task.affectedFiles.length > 0 && (
        <p className={styles.files}>
          {task.affectedFiles.map((file) => (
            <code key={file}>{file}</code>
          ))}
        </p>
      )}

      <details className={styles.suggestion}>
        <summary>How to do it</summary>
        <p>
          <InlineText text={task.suggestedImplementation} />
        </p>
      </details>

      <div className={styles.actions}>
        {task.status !== 'approved' && (
          <button type="button" className={styles.approve} disabled={busy} onClick={() => onChange('approved')}>
            Approve
          </button>
        )}
        {task.status !== 'discarded' && (
          <button type="button" className={styles.discard} disabled={busy} onClick={() => onChange('discarded')}>
            Discard
          </button>
        )}
        {task.status !== 'pending' && (
          <button type="button" className={styles.reset} disabled={busy} onClick={() => onChange('pending')}>
            Back to pending
          </button>
        )}
      </div>
    </li>
  );
}
