export interface TextPart {
  text: string;
  /** True for text that was between backticks, e.g. `handleUpload`. */
  code: boolean;
}

/**
 * Splits "Add errors to `handleUpload` in `api.ts`" into plain and code parts.
 * A backtick without its closing pair is kept as plain text.
 * Only splits: rendering is done by React, so no HTML is ever injected.
 */
export function splitInlineCode(input: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /`([^`\n]+)`/g;
  let last = 0;

  for (const match of input.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: input.slice(last, start), code: false });
    parts.push({ text: match[1] ?? '', code: true });
    last = start + match[0].length;
  }

  if (last < input.length) parts.push({ text: input.slice(last), code: false });
  return parts;
}
