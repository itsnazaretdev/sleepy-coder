import type { LanguageStat } from '@sleepy-coder/shared';
import type { ScannedFile } from './scan.js';

/**
 * Extensions counted as code. Data and prose (JSON, YAML, Markdown…) are left out
 * on purpose, like GitHub does, so a big lockfile does not look like a "language".
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  astro: 'Astro',
  vue: 'Vue',
  svelte: 'Svelte',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'SCSS',
  less: 'Less',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  py: 'Python',
  php: 'PHP',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  hpp: 'C++',
  cs: 'C#',
  swift: 'Swift',
  dart: 'Dart',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
};

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  // Minified bundles are build output, not source code.
  if (name.includes('.min.')) return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/** Groups files by language, sorted by size (largest first). */
export function summarizeLanguages(files: ScannedFile[]): LanguageStat[] {
  const totals = new Map<string, { files: number; bytes: number }>();

  for (const file of files) {
    const language = languageOf(file.path);
    if (!language) continue;
    const current = totals.get(language) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += file.size;
    totals.set(language, current);
  }

  const totalBytes = [...totals.values()].reduce((sum, t) => sum + t.bytes, 0);

  return [...totals.entries()]
    .map(([language, t]) => ({
      language,
      files: t.files,
      bytes: t.bytes,
      percent: totalBytes === 0 ? 0 : Math.round((t.bytes / totalBytes) * 1000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));
}
