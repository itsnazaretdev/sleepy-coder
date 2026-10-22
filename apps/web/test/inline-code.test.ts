import { describe, expect, it } from 'vitest';
import { splitInlineCode } from '../src/lib/inline-code';

describe('splitInlineCode', () => {
  it('splits text and code parts', () => {
    expect(splitInlineCode('Add error handling to `handleUpload` in `src/api.ts`')).toEqual([
      { text: 'Add error handling to ', code: false },
      { text: 'handleUpload', code: true },
      { text: ' in ', code: false },
      { text: 'src/api.ts', code: true },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(splitInlineCode('Add a license')).toEqual([{ text: 'Add a license', code: false }]);
  });

  it('handles code at the start and the end', () => {
    expect(splitInlineCode('`a` and `b`')).toEqual([
      { text: 'a', code: true },
      { text: ' and ', code: false },
      { text: 'b', code: true },
    ]);
  });

  it('keeps an unclosed backtick as plain text', () => {
    expect(splitInlineCode('Rename `foo to bar')).toEqual([{ text: 'Rename `foo to bar', code: false }]);
  });

  it('ignores empty backticks', () => {
    expect(splitInlineCode('a `` b')).toEqual([{ text: 'a `` b', code: false }]);
  });

  it('returns nothing for an empty string', () => {
    expect(splitInlineCode('')).toEqual([]);
  });
});
