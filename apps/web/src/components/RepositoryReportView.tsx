import type { GitInfo, RepositoryReport } from '@sleepy-coder/shared';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { groupLanguages } from '../lib/languages';
import { WARNING_MESSAGES } from '../lib/messages';
import styles from './RepositoryReportView.module.css';

interface Props {
  report: RepositoryReport;
  onReanalyze: () => void;
  analyzing: boolean;
}

/** Presentational component: renders one repository analysis. */
export default function RepositoryReportView({ report, onReanalyze, analyzing }: Props) {
  const slices = groupLanguages(report.languages);

  return (
    <article className={styles.report}>
      <header className={styles.header}>
        <div>
          <h2>{report.repository.name}</h2>
          <code className={styles.path}>{report.repository.path}</code>
        </div>
        <button type="button" className={styles.button} onClick={onReanalyze} disabled={analyzing}>
          {analyzing ? 'Analyzing…' : 'Analyze again'}
        </button>
      </header>

      <p className={styles.meta}>
        Analyzed on {formatDate(report.analyzedAt)} · {formatDuration(report.durationMs)}
      </p>

      {report.warnings.length > 0 && (
        <section className={styles.warnings} aria-label="Warnings">
          <ul>
            {report.warnings.map((code) => (
              <li key={code}>{WARNING_MESSAGES[code]}</li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h3>Git</h3>
          <GitSummary git={report.git} />
        </section>

        <section className={styles.panel}>
          <h3>Files</h3>
          <dl className={styles.stats}>
            <dt>Files</dt>
            <dd>{report.files.total.toLocaleString('en-US')}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(report.files.totalBytes)}</dd>
            <dt>Tests</dt>
            <dd>{report.files.testFiles.toLocaleString('en-US')}</dd>
          </dl>
        </section>

        <section className={`${styles.panel} ${styles.wide}`}>
          <h3>Languages</h3>
          {slices.length === 0 ? (
            <p className={styles.muted}>No source code found.</p>
          ) : (
            <>
              <div className={styles.bar} role="img" aria-label="Language breakdown">
                {slices.map((slice, index) => (
                  <span
                    key={slice.language}
                    style={{ width: `${slice.percent}%`, background: `var(--chart-${index + 1})` }}
                  />
                ))}
              </div>
              <ul className={styles.legend}>
                {slices.map((slice, index) => (
                  <li key={slice.language}>
                    <span className={styles.swatch} style={{ background: `var(--chart-${index + 1})` }} />
                    {slice.language}
                    <span className={styles.muted}>{slice.percent.toLocaleString('en-US')}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className={`${styles.panel} ${styles.wide}`}>
          <h3>Stack</h3>
          <ChipRow label="Package managers" items={report.packageManagers} />
          <ChipRow label="Frameworks" items={report.frameworks} />
          <ChipRow label="Testing" items={report.testingTools} />
          <ChipRow label="Configuration" items={report.configFiles} />
        </section>
      </div>
    </article>
  );
}

function GitSummary({ git }: { git: GitInfo }) {
  return (
    <dl className={styles.stats}>
      <dt>Branch</dt>
      <dd>
        <code>{git.branch ?? 'detached HEAD'}</code>
      </dd>

      <dt>Status</dt>
      <dd className={git.isClean ? styles.ok : styles.warn}>
        {git.isClean
          ? 'Clean'
          : `${git.changedFiles} modified · ${git.untrackedFiles} untracked`}
      </dd>

      {git.tracking && (
        <>
          <dt>Remote</dt>
          <dd>
            <code>{git.tracking}</code>
            {(git.ahead > 0 || git.behind > 0) && (
              <span className={styles.muted}>
                {' '}
                ↑{git.ahead} ↓{git.behind}
              </span>
            )}
          </dd>
        </>
      )}

      <dt>Last commit</dt>
      <dd>
        {git.lastCommit ? (
          <>
            {git.lastCommit.message}
            <span className={styles.commitMeta}>
              {git.lastCommit.author} · {formatDate(git.lastCommit.date)}
            </span>
          </>
        ) : (
          <span className={styles.muted}>No commits yet</span>
        )}
      </dd>
    </dl>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className={styles.chipRow}>
      <span className={styles.chipLabel}>{label}</span>
      {items.length === 0 ? (
        <span className={styles.muted}>—</span>
      ) : (
        <ul className={styles.chips}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
