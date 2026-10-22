import { splitInlineCode } from '../lib/inline-code';
import styles from './InlineText.module.css';

/** Renders text where `backticked` parts are shown as code. */
export default function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((part, index) =>
        part.code ? (
          <code key={index} className={styles.code}>
            {part.text}
          </code>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
