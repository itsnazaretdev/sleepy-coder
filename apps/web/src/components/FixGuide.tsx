import { useEffect, useState } from 'react';
import type { CodeLocation, FixGuide as Guide, Task } from '@sleepy-coder/shared';
import { ApiRequestError, checkTask, createTaskGuide, fetchTaskGuide, updateTaskStatus } from '../lib/api';
import { describeError } from '../lib/messages';
import { editorLink, snippetLines } from '../lib/tasks';
import InlineText from './InlineText';
import styles from './FixGuide.module.css';

interface Props {
  task: Task;
  /** Called when the task changed status (e.g. "Check again" found it fixed). */
  onTaskChange: (task: Task) => void;
}

const errorMessage = (error: unknown) =>
  error instanceof ApiRequestError ? describeError(error.code) : 'No connection to the backend.';

/**
 * Fix guide for one task: WHERE the problem is (found by rules, always exact), HOW to fix it
 * (written by Gemma on request) and a way to confirm it is fixed. Nothing is changed for you:
 * you make the change in your editor.
 */
export default function FixGuide({ task, onTaskChange }: Props) {
  const [locations, setLocations] = useState<CodeLocation[] | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState<'none' | 'guide' | 'check' | 'done'>('none');
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTaskGuide(task.id)
      .then((response) => {
        if (cancelled) return;
        setLocations(response.locations);
        setGuide(response.guide);
      })
      .catch((error) => !cancelled && setLoadError(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const askModel = async () => {
    setBusy('guide');
    setMessage(null);
    try {
      const response = await createTaskGuide(task.id);
      setLocations(response.locations);
      setGuide(response.guide);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('none');
    }
  };

  const checkAgain = async () => {
    setBusy('check');
    setMessage(null);
    try {
      const result = await checkTask(task.id);
      if (result.fixed) {
        onTaskChange(result.task);
      } else {
        setLocations(result.locations);
        setMessage('Still there. Save the file and check again once you have changed it.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('none');
    }
  };

  /** AI tasks have no rule to check them: the user decides. */
  /** "done" when the user fixed it; "discarded" when the task turned out to be wrong. */
  const close = async (status: 'done' | 'discarded') => {
    setBusy('done');
    setMessage(null);
    try {
      onTaskChange(await updateTaskStatus(task.id, status));
    } catch (error) {
      setMessage(errorMessage(error));
      setBusy('none');
    }
  };

  const canCheck = task.source === 'static';

  return (
    <section className={styles.panel} aria-label="How to fix">
      <h4 className={styles.heading}>Where</h4>
      {loadError && <p className={styles.error}>{loadError}</p>}
      {!loadError && locations === null && <p className={styles.muted}>Looking for the problem…</p>}
      {locations?.length === 0 && <p className={styles.muted}>This task is not linked to a specific file.</p>}
      {locations && locations.length > 0 && (
        <ul className={styles.locations}>
          {locations.map((location, index) => (
            <LocationView key={`${location.path}:${location.line ?? index}`} location={location} />
          ))}
        </ul>
      )}

      <h4 className={styles.heading}>How</h4>
      {busy === 'guide' ? (
        <p className={styles.thinking}>Gemma is reading the code around the problem. This can take a minute.</p>
      ) : guide ? (
        <GuideView guide={guide} disabled={busy !== 'none'} onDiscard={() => void close('discarded')} />
      ) : (
        <p className={styles.muted}>
          <InlineText text={task.suggestedImplementation} />
        </p>
      )}

      {message && <p className={styles.message}>{message}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.ask} disabled={busy !== 'none'} onClick={() => void askModel()}>
          {busy === 'guide' ? 'Gemma is thinking…' : guide ? 'Ask Gemma again' : 'Ask Gemma how to fix it'}
        </button>
        {canCheck ? (
          <button type="button" className={styles.check} disabled={busy !== 'none'} onClick={() => void checkAgain()}>
            {busy === 'check' ? 'Checking…' : 'I fixed it — check again'}
          </button>
        ) : (
          <button type="button" className={styles.check} disabled={busy !== 'none'} onClick={() => void close('done')}>
            Mark as done
          </button>
        )}
      </div>
      <p className={styles.hint}>
        {canCheck
          ? 'Sleepy Coder never changes your files. Fix it in your editor, save, and the same rule that found the problem will check it again.'
          : 'Sleepy Coder never changes your files. This task was suggested by AI, so there is no rule to check it: mark it as done when you are happy with the change.'}
      </p>
    </section>
  );
}

function LocationView({ location }: { location: CodeLocation }) {
  const lines = snippetLines(location);
  return (
    <li className={styles.location}>
      <div className={styles.locationHead}>
        <code className={styles.path}>
          {location.path}
          {location.line ? `:${location.line}` : ''}
        </code>
        <span className={location.exists ? styles.note : `${styles.note} ${styles.create}`}>
          <InlineText text={location.note} />
        </span>
        {location.exists && (
          <a className={styles.open} href={editorLink(location)}>
            Open in VS Code
          </a>
        )}
      </div>
      {lines.length > 0 && (
        <pre className={styles.snippet}>
          {lines.map((line) => (
            <span key={line.number} className={line.highlight ? styles.highlight : undefined}>
              <span className={styles.lineNumber}>{line.number}</span>
              {line.text}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </li>
  );
}

interface GuideViewProps {
  guide: Guide;
  disabled: boolean;
  onDiscard: () => void;
}

function GuideView({ guide, disabled, onDiscard }: GuideViewProps) {
  // The model read the real code and says the problem is not there (AI suggestions can be wrong).
  if (!guide.applies) {
    return (
      <div className={styles.notApplies}>
        <p className={styles.notAppliesTitle}>Gemma looked at the code and thinks this task does not apply.</p>
        {guide.explanation && (
          <p>
            <InlineText text={guide.explanation} />
          </p>
        )}
        <p className={styles.muted}>Check the file yourself. If it is right, discard the task.</p>
        <div>
          <button type="button" className={styles.discard} disabled={disabled} onClick={onDiscard}>
            Discard task
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.guide}>
      {guide.explanation && (
        <p>
          <InlineText text={guide.explanation} />
        </p>
      )}
      {guide.steps.length > 0 && (
        <ol className={styles.steps}>
          {guide.steps.map((step, index) => (
            <li key={index}>
              <InlineText text={step} />
            </li>
          ))}
        </ol>
      )}
      {guide.suggestions.map((suggestion, index) => (
        <figure key={index} className={styles.suggestion}>
          <figcaption>
            <span>
              Suggested code for <code>{suggestion.path}</code>
            </span>
            <CopyButton text={suggestion.code} />
          </figcaption>
          <pre>{suggestion.code}</pre>
        </figure>
      ))}
      <p className={styles.disclaimer}>
        Written by {guide.model}. It can be wrong: read it before copying anything.
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard blocked: the code can still be selected by hand.
    }
  };
  return (
    <button type="button" className={styles.copy} onClick={() => void copy()}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
