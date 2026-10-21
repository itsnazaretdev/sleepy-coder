import { useCallback, useEffect, useState } from 'react';
import type { OllamaStatusResponse, OllamaTestResponse } from '@sleepy-coder/shared';
import { ApiRequestError, fetchOllamaStatus, testOllamaModel } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/format';
import { describeError } from '../lib/messages';
import styles from './OllamaStatus.module.css';

type StatusState =
  | { kind: 'loading' }
  | { kind: 'backend-offline' }
  | { kind: 'ready'; data: OllamaStatusResponse };

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: OllamaTestResponse }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 15_000;

/** React Island: shows Ollama status, installed models and lets you test the model. */
export default function OllamaStatus() {
  const [status, setStatus] = useState<StatusState>({ kind: 'loading' });
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const refresh = useCallback(async () => {
    try {
      setStatus({ kind: 'ready', data: await fetchOllamaStatus() });
    } catch {
      setStatus({ kind: 'backend-offline' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const runTest = async () => {
    setTest({ kind: 'running' });
    try {
      setTest({ kind: 'done', result: await testOllamaModel() });
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? describeError(error.code)
          : 'Sin respuesta del backend. ¿Sigue arrancado?';
      setTest({ kind: 'error', message });
    }
  };

  // Read here, outside the JSX callbacks: TypeScript does not keep the
  // `status.data.running` narrowing inside the `.map()` arrow function.
  const selectedModelName =
    status.kind === 'ready' && status.data.running ? status.data.selectedModel : null;

  const dotClass =
    status.kind === 'loading'
      ? styles.loading
      : status.kind === 'ready' && status.data.running
        ? styles.online
        : styles.offline;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
        <h2 className={styles.title}>Ollama</h2>
        {status.kind === 'ready' && status.data.running && (
          <span className={styles.version}>v{status.data.version}</span>
        )}
      </div>

      {status.kind === 'loading' && <p className={styles.muted}>Comprobando…</p>}

      {status.kind === 'backend-offline' && (
        <p className={styles.muted}>Necesito el backend encendido para consultar Ollama.</p>
      )}

      {status.kind === 'ready' && !status.data.running && (
        <>
          <p className={styles.muted}>{describeError(status.data.errorCode)}</p>
          <button type="button" className={styles.button} onClick={() => void refresh()}>
            Reintentar
          </button>
        </>
      )}

      {status.kind === 'ready' && status.data.running && (
        <>
          {status.data.models.length === 0 ? (
            <p className={styles.muted}>{describeError('no-model')}</p>
          ) : (
            <ul className={styles.models}>
              {status.data.models.map((m) => {
                const selected = m.name === selectedModelName;
                return (
                  <li key={m.name} className={selected ? styles.selected : undefined}>
                    <code>{m.name}</code>
                    <span className={styles.size}>{formatBytes(m.sizeBytes)}</span>
                    {selected && <span className={styles.badge}>en uso</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {status.data.selectedModel && !status.data.selectedModelAvailable && (
            <p className={styles.warning}>
              El modelo configurado <code>{status.data.selectedModel}</code> no está instalado.
            </p>
          )}

          {status.data.selectedModelAvailable && (
            <div className={styles.test}>
              <button
                type="button"
                className={styles.button}
                onClick={() => void runTest()}
                disabled={test.kind === 'running'}
              >
                {test.kind === 'running' ? 'Despertando al modelo…' : 'Probar modelo'}
              </button>

              {test.kind === 'running' && (
                <p className={styles.muted}>La primera vez puede tardar un poco mientras se carga en memoria.</p>
              )}

              {test.kind === 'done' && (
                <blockquote className={styles.reply}>
                  <p>{test.result.reply}</p>
                  <footer>
                    {test.result.model} · {formatDuration(test.result.durationMs)}
                  </footer>
                </blockquote>
              )}

              {test.kind === 'error' && <p className={styles.warning}>{test.message}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}