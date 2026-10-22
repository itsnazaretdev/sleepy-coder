import { describe, expect, it } from 'vitest';
import { languageOf, summarizeLanguages } from '../src/index.js';

describe('languageOf', () => {
  it.each([
    ['src/app.ts', 'TypeScript'],
    ['src/App.TSX', 'TypeScript'],
    ['pages/index.astro', 'Astro'],
    ['Main.java', 'Java'],
    ['styles/main.css', 'CSS'],
  ])('%s → %s', (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it.each(['README.md', 'package.json', 'config.yml', 'Makefile', '.gitignore', 'public/vendor.min.js'])(
    'ignores %s',
    (path) => {
      expect(languageOf(path)).toBeNull();
    },
  );
});

describe('summarizeLanguages', () => {
  it('groups by language and computes byte percentages, largest first', () => {
    const stats = summarizeLanguages([
      { path: 'a.ts', size: 600 },
      { path: 'b.tsx', size: 150 },
      { path: 'c.css', size: 250 },
      { path: 'README.md', size: 10_000 },
    ]);

    expect(stats).toEqual([
      { language: 'TypeScript', files: 2, bytes: 750, percent: 75 },
      { language: 'CSS', files: 1, bytes: 250, percent: 25 },
    ]);
  });

  it('returns an empty list when there is no code', () => {
    expect(summarizeLanguages([{ path: 'notes.md', size: 10 }])).toEqual([]);
  });
});
