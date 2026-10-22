import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Repository, RepositoryReport } from '@sleepy-coder/shared';
import {
  addRepository,
  analyzeRepository,
  ApiRequestError,
  fetchRepositories,
  pickFolder,
  removeRepository,
} from '../lib/api';
import { describeError } from '../lib/messages';
import RepositoryReportView from './RepositoryReportView';
import styles from './RepositoryManager.module.css';

type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; repositories: Repository[] };

type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: RepositoryReport | null }
  | { kind: 'done'; report: RepositoryReport }
  | { kind: 'error'; message: string };

const OFFLINE_MESSAGE = 'Sin conexión con el backend. Arráncalo con "pnpm dev:server".';

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? describeError(error.code) : OFFLINE_MESSAGE;
}

/** Keeps the selected repository in the URL (?repo=…) so a reload keeps it. */
function readSelectedFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('repo');
}

function writeSelectedToUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('repo', id);
  else url.searchParams.delete('repo');
  window.history.replaceState(null, '', url);
}

/** React Island: add, list, remove and analyze local repositories. */
export default function RepositoryManager() {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [path, setPath] = useState('');
  /** What the "add" area is doing right now. */
  const [busy, setBusy] = useState<'idle' | 'picking' | 'adding'>('idle');
  const [addError, setAddError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'idle' });

  const runAnalysis = useCallback(async (id: string) => {
    setAnalysis((current) => ({
      kind: 'loading',
      previous: current.kind === 'done' && current.report.repository.id === id ? current.report : null,
    }));
    try {
      setAnalysis({ kind: 'done', report: await analyzeRepository(id) });
    } catch (error) {
      setAnalysis({ kind: 'error', message: errorMessage(error) });
    }
  }, []);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      writeSelectedToUrl(id);
      if (id) void runAnalysis(id);
      else setAnalysis({ kind: 'idle' });
    },
    [runAnalysis],
  );

  const loadList = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const repositories = await fetchRepositories();
      setList({ kind: 'ready', repositories });
      return repositories;
    } catch {
      setList({ kind: 'error' });
      return null;
    }
  }, []);

  useEffect(() => {
    void loadList().then((repositories) => {
      const fromUrl = readSelectedFromUrl();
      if (repositories && fromUrl && repositories.some((r) => r.id === fromUrl)) select(fromUrl);
    });
  }, [loadList, select]);

  /** Adds a repository by path and opens its analysis. Returns true on success. */
  const addPath = async (value: string): Promise<boolean> => {
    setBusy('adding');
    setAddError(null);
    try {
      const repository = await addRepository(value);
      await loadList();
      select(repository.id);
      return true;
    } catch (error) {
      setAddError(errorMessage(error));
      return false;
    } finally {
      setBusy('idle');
    }
  };

  const handlePick = async () => {
    setBusy('picking');
    setAddError(null);
    let picked: string | null;
    try {
      picked = await pickFolder();
    } catch (error) {
      setAddError(errorMessage(error));
      setBusy('idle');
      return;
    }
    if (!picked) {
      setBusy('idle'); // Cancelled: nothing to do.
      return;
    }
    await addPath(picked);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim()) return;
    if (await addPath(path)) setPath('');
  };

  const handleRemove = async (repository: Repository) => {
    try {
      await removeRepository(repository.id);
    } catch {
      // If it was already gone, reloading the list is enough.
    }
    if (selectedId === repository.id) select(null);
    await loadList();
  };

  const repositories = list.kind === 'ready' ? list.repositories : [];
  const shownReport =
    analysis.kind === 'done' ? analysis.report : analysis.kind === 'loading' ? analysis.previous : null;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.form}>
          <h2 className={styles.formTitle}>Añadir repositorio</h2>

          <button
            type="button"
            className={styles.primary}
            onClick={() => void handlePick()}
            disabled={busy !== 'idle'}
          >
            {busy === 'picking' ? 'Esperando al Finder…' : busy === 'adding' ? 'Comprobando…' : 'Elegir carpeta…'}
          </button>

          {busy === 'picking' && (
            <p className={styles.hint}>
              Se ha abierto una ventana del Finder. Si no la ves, puede estar detrás del navegador.
            </p>
          )}

          {addError && <p className={styles.error}>{addError}</p>}

          <details className={styles.manual}>
            <summary>O escribe la ruta a mano</summary>
            <form className={styles.manualForm} onSubmit={(e) => void handleSubmit(e)}>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="~/Desktop/mi-app"
                aria-label="Ruta del repositorio"
                spellCheck={false}
                autoComplete="off"
                disabled={busy !== 'idle'}
              />
              <button type="submit" className={styles.secondary} disabled={busy !== 'idle' || !path.trim()}>
                Añadir
              </button>
            </form>
          </details>
        </div>

        <div className={styles.listBlock}>
          <h2>Tus repositorios</h2>

          {list.kind === 'loading' && <p className={styles.muted}>Cargando…</p>}

          {list.kind === 'error' && (
            <>
              <p className={styles.error}>{OFFLINE_MESSAGE}</p>
              <button type="button" className={styles.secondary} onClick={() => void loadList()}>
                Reintentar
              </button>
            </>
          )}

          {list.kind === 'ready' && repositories.length === 0 && (
            <p className={styles.muted}>Aún no has añadido ninguno.</p>
          )}

          {repositories.length > 0 && (
            <ul className={styles.list}>
              {repositories.map((repository) => (
                <li key={repository.id} className={repository.id === selectedId ? styles.active : undefined}>
                  <button type="button" className={styles.item} onClick={() => select(repository.id)}>
                    <span className={styles.name}>{repository.name}</span>
                    <span className={styles.itemPath}>{repository.path}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => void handleRemove(repository)}
                    title="Quitar de la lista (no borra nada del disco)"
                    aria-label={`Quitar ${repository.name} de la lista`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={styles.main}>
        {!selectedId && (
          <div className={styles.empty}>
            <p>Elige un repositorio para ver su análisis.</p>
            <p className={styles.muted}>El análisis es de solo lectura: no modifica nada.</p>
          </div>
        )}

        {selectedId && analysis.kind === 'loading' && !shownReport && (
          <p className={styles.muted}>Analizando repositorio…</p>
        )}

        {selectedId && analysis.kind === 'error' && (
          <div className={styles.empty}>
            <p className={styles.error}>{analysis.message}</p>
            <button type="button" className={styles.secondary} onClick={() => void runAnalysis(selectedId)}>
              Reintentar
            </button>
          </div>
        )}

        {selectedId && shownReport && (
          <RepositoryReportView
            report={shownReport}
            analyzing={analysis.kind === 'loading'}
            onReanalyze={() => void runAnalysis(selectedId)}
          />
        )}
      </section>
    </div>
  );
}