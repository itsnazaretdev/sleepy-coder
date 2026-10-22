import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@sleepy-coder/shared';
import { fetchHealth } from '../lib/api';
import { formatUptime } from '../lib/format';
import styles from './HealthStatus.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'online'; data: HealthResponse }
  | { kind: 'offline' };

const POLL_INTERVAL_MS = 10_000;

/** React Island: shows whether the local backend is reachable. */
export default function HealthStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const check = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setState({ kind: 'online', data });
    } catch {
      setState({ kind: 'offline' });
    }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={`${styles.dot} ${styles[state.kind]}`} aria-hidden="true" />
        <h2 className={styles.title}>Backend</h2>
      </div>

      {state.kind === 'loading' && <p className={styles.muted}>Checking…</p>}

      {state.kind === 'online' && (
        <dl className={styles.details}>
          <dt>Status</dt>
          <dd>Connected</dd>
          <dt>Version</dt>
          <dd>{state.data.version}</dd>
          <dt>Uptime</dt>
          <dd>{formatUptime(state.data.uptime)}</dd>
        </dl>
      )}

      {state.kind === 'offline' && (
        <>
          <p className={styles.muted}>
            Not connected. Start the server with <code>pnpm dev:server</code>.
          </p>
          <button type="button" className={styles.retry} onClick={() => void check()}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
