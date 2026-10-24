import { useCallback, useEffect, useState } from 'react';
import type { Task, TaskRun, TaskStatus } from '@sleepy-coder/shared';
import {
  ApiRequestError,
  fetchConfig,
  fetchLatestRuns,
  fetchRun,
  fetchTasks,
  huntTasks,
  runTask,
  suggestTasks,
  updateTaskStatus,
} from '../lib/api';
import { describeError } from '../lib/messages';
import { runsByTask } from '../lib/runs';
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
import FixGuide from './FixGuide';
import InlineText from './InlineText';
import RunResult from './RunResult';
import styles from './TaskBoard.module.css';

interface Props {
  repositoryId: string;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; tasks: Task[] };

const OFFLINE_MESSAGE = 'No connection to the backend.';
const errorMessage = (error: unknown) =>
  error instanceof ApiRequestError ? describeError(error.code) : OFFLINE_MESSAGE;

/** How often a running (experimental) agent run is checked. */
const RUN_POLL_MS = 2_000;

/** React component: tasks of one repository, with hunting, review and fix guides. */
export default function TaskBoard({ repositoryId }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  /** The autonomous agent ("Run") is experimental and hidden unless the backend enables it. */
  const [experimentalAgent, setExperimentalAgent] = useState(false);
  const [runs, setRuns] = useState<Map<string, TaskRun>>(new Map());
  const [tab, setTab] = useState<TaskStatus>('pending');
  /** Which search is running, if any. Only one at a time. */
  const [searching, setSearching] = useState<'none' | 'static' | 'ai'>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);


  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [tasks, config] = await Promise.all([
        fetchTasks(repositoryId),
        fetchConfig().catch(() => ({ experimentalAgent: false })),
      ]);
      setState({ kind: 'ready', tasks });
      setExperimentalAgent(config.experimentalAgent);
      if (config.experimentalAgent) {
        setRuns(runsByTask(await fetchLatestRuns(repositoryId).catch(() => [] as TaskRun[])));
      }
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, [repositoryId]);

  useEffect(() => {
    setTab('pending');
    setNotice(null);
    void load();
  }, [load]);

  // Ids of runs in progress, as one string so the effect below only restarts when they change.
  const runningKey = [...runs.values()]
    .filter((run) => run.status === 'running')
    .map((run) => run.id)
    .join(',');
  const agentBusy = runningKey !== '';

  // While a run is in progress, refresh it every few seconds.
  useEffect(() => {
    if (!runningKey) return;
    const ids = runningKey.split(',');
    const timer = setInterval(async () => {
      const updated = await Promise.all(ids.map((id) => fetchRun(id).catch(() => null)));
      setRuns((current) => {
        const next = new Map(current);
        for (const run of updated) if (run) next.set(run.taskId, run);
        return next;
      });
    }, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [runningKey]);

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

  /** A task changed somewhere else (e.g. "Check again" found it fixed). */
  const taskChanged = (updated: Task) => {
    setState((current) => (current.kind === 'ready' ? { kind: 'ready', tasks: replaceTask(current.tasks, updated) } : current));
    if (updated.status === 'done') setNotice('Fixed! The task moved to Done.');
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

  const startRun = async (task: Task) => {
    setNotice(null);
    try {
      const run = await runTask(task.id);
      setRuns((current) => new Map(current).set(task.id, run));
    } catch (error) {
      setNotice(errorMessage(error));
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
          <p className={styles.muted}>
            Review what was found and approve what you want to fix. Sleepy Coder shows you where and how; you make the
            change.
          </p>
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
          Gemma is reading part of your code. This can take a minute or two, especially the first time. Its ideas
          are a starting point, not facts: check them before acting on them.
        </p>
      )}

      {notice && <p className={styles.notice}>{notice}</p>}

      {state.kind === 'loading' && <p className={styles.muted}>Loading tasks…</p>}
      {state.kind === 'error' && <p className={styles.error}>{state.message}</p>}

      {state.kind === 'ready' && tasks.length === 0 && (
        <div className={styles.empty}>
          <p>No tasks yet.</p>
          <p className={styles.muted}>
            <strong>Find tasks</strong> uses rules, without AI: TODO and FIXME comments, SEO and accessibility issues,
            and files the repository is missing. What it finds is really there.
            <br />
            <strong>Suggest with AI</strong> asks Gemma, a small local model, for ideas. They can be wrong: check them
            against your code before acting on them.
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

          {tab === 'approved' && visible.length > 0 && (
            <p className={styles.muted}>
              “How to fix” shows the exact lines and asks Gemma for a guide. Nothing is changed in your repository.
              {experimentalAgent && (
                <>
                  {' '}
                  Experimental: “Run” lets the agent try the task on its own <code>sleepy/…</code> branch.
                </>
              )}
            </p>
          )}

          {visible.length === 0 ? (
            <p className={styles.muted}>Nothing here.</p>
          ) : (
            <ul className={styles.list}>
              {visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  run={runs.get(task.id) ?? null}
                  busy={updatingId === task.id}
                  agentBusy={agentBusy}
                  experimentalAgent={experimentalAgent}
                  onChange={(status) => void changeStatus(task, status)}
                  onTaskChange={taskChanged}
                  onRun={() => void startRun(task)}
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
  run: TaskRun | null;
  busy: boolean;
  /** True while the agent is running any task (one at a time). */
  agentBusy: boolean;
  experimentalAgent: boolean;
  onChange: (status: TaskStatus) => void;
  onTaskChange: (task: Task) => void;
  onRun: () => void;
}

function TaskCard({ task, run, busy, agentBusy, experimentalAgent, onChange, onTaskChange, onRun }: TaskCardProps) {
  const isRunning = run?.status === 'running';
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <li className={task.source === 'ai' ? `${styles.card} ${styles.aiCard}` : styles.card}>
      <div className={styles.cardHead}>
        <h3>
          {task.source === 'ai' && <span className={styles.aiBadge}>AI idea</span>}
          <InlineText text={task.title} />
        </h3>
        <span className={`${styles.priority} ${styles[task.priority]}`}>{LEVEL_LABELS[task.priority]} priority</span>
      </div>

      <p className={styles.description}>
        <InlineText text={task.description} />
      </p>

      {task.source === 'ai' && (
        <p className={styles.aiWarning}>
          Idea from a small local model. It may describe code that is not there: open the file and check it before
          approving.
        </p>
      )}

      <ul className={styles.meta}>
        <li>{CATEGORY_LABELS[task.category]}</li>
        <li>{COMPLEXITY_LABELS[task.complexity]} complexity</li>
        <li>{LEVEL_LABELS[task.risk]} risk</li>
        <li className={task.source === 'ai' ? styles.sourceAi : styles.sourceRule}>
          {task.source === 'ai' ? 'AI idea · verify it' : 'Found by a rule · reliable'}
        </li>
      </ul>

      {task.affectedFiles.length > 0 && (
        <p className={styles.files}>
          {task.affectedFiles.map((file) => (
            <code key={file}>{file}</code>
          ))}
        </p>
      )}

      <details className={styles.suggestion}>
        <summary>Quick hint</summary>
        <p>
          <InlineText text={task.suggestedImplementation} />
        </p>
      </details>

      <div className={styles.actions}>
        {task.status === 'approved' && (
          <button
            type="button"
            className={styles.run}
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen((open) => !open)}
          >
            {guideOpen ? 'Hide guide' : 'How to fix'}
          </button>
        )}
        {task.status === 'approved' && experimentalAgent && (
          <button
            type="button"
            className={styles.experimental}
            disabled={busy || agentBusy}
            title={agentBusy && !isRunning ? 'The agent is working on another task' : undefined}
            onClick={onRun}
          >
            {isRunning ? 'Running…' : run ? 'Run again (experimental)' : 'Run (experimental)'}
          </button>
        )}
        {task.status === 'pending' && (
          <button type="button" className={styles.approve} disabled={busy} onClick={() => onChange('approved')}>
            Approve
          </button>
        )}
        {(task.status === 'pending' || task.status === 'approved') && (
          <button
            type="button"
            className={styles.discard}
            disabled={busy || isRunning}
            onClick={() => onChange('discarded')}
          >
            Discard
          </button>
        )}
        {task.status !== 'pending' && (
          <button
            type="button"
            className={styles.reset}
            disabled={busy || isRunning}
            onClick={() => onChange('pending')}
          >
            Back to pending
          </button>
        )}
      </div>

      {guideOpen && task.status === 'approved' && <FixGuide task={task} onTaskChange={onTaskChange} />}

      {experimentalAgent && run && <RunResult run={run} />}
    </li>
  );
}
