import type { RunTestResult, TaskRun } from '@sleepy-coder/shared';
import { formatDuration } from '../lib/format';
import { diffLineKind, lastStep, RUN_STATUS_LABELS } from '../lib/runs';
import InlineText from './InlineText';
import styles from './RunResult.module.css';

/** Shows the progress or the result of the latest agent run of a task. */
export default function RunResult({ run }: { run: TaskRun }) {
  if (run.status === 'running') {
    return (
      <div className={`${styles.panel} ${styles.running}`}>
        <span className={styles.spinner} aria-hidden="true" />
        <span>{lastStep(run)}</span>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={`${styles.badge} ${styles[run.status]}`}>{RUN_STATUS_LABELS[run.status]}</span>
        {run.branch && (
          <span className={styles.branch}>
            on <code>{run.branch}</code>
          </span>
        )}
      </div>

      {run.summary && (
        <p className={styles.summary}>
          <InlineText text={run.summary} />
        </p>
      )}
      {run.error && <p className={styles.error}>{run.error}</p>}

      {run.files.length > 0 && (
        <ul className={styles.files}>
          {run.files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              {file.additions !== null && <span className={styles.add}>+{file.additions}</span>}
              {file.deletions !== null && <span className={styles.del}>−{file.deletions}</span>}
            </li>
          ))}
        </ul>
      )}

      {(run.testsBefore || run.testsAfter) && (
        <div className={styles.tests}>
          {run.testsBefore && <TestLine label="Tests before" result={run.testsBefore} />}
          {run.testsAfter && <TestLine label="Tests after" result={run.testsAfter} />}
        </div>
      )}

      {run.diff && (
        <details className={styles.details}>
          <summary>View diff</summary>
          <pre className={styles.diff}>
            {run.diff.split('\n').map((line, index) => (
              <span key={index} className={styles[diffLineKind(line)]}>
                {line || ' '}
                {'\n'}
              </span>
            ))}
          </pre>
        </details>
      )}

      {run.steps.length > 0 && (
        <details className={styles.details}>
          <summary>Steps</summary>
          <ol className={styles.steps}>
            {run.steps.map((step, index) => (
              <li key={index}>{step.message}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function TestLine({ label, result }: { label: string; result: RunTestResult }) {
  return (
    <details className={styles.testLine}>
      <summary>
        <span className={result.passed ? styles.pass : styles.fail}>{result.passed ? '✓' : '✗'}</span> {label}:{' '}
        {result.passed ? 'passed' : result.timedOut ? 'timed out' : 'failed'}
        <span className={styles.muted}>
          {' '}
          · <code>{result.command}</code> · {formatDuration(result.durationMs)}
        </span>
      </summary>
      {result.output && <pre className={styles.output}>{result.output}</pre>}
    </details>
  );
}
