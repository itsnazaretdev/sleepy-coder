import type { LanguageStat } from '@sleepy-coder/shared';

export interface LanguageSlice {
  language: string;
  percent: number;
}

/**
 * Keeps the `max` biggest languages and merges the rest into "Otros",
 * so the bar stays readable. Input is expected sorted (largest first).
 */
export function groupLanguages(languages: LanguageStat[], max = 5): LanguageSlice[] {
  const top = languages.slice(0, max).map(({ language, percent }) => ({ language, percent }));
  const rest = languages.slice(max);

  if (rest.length === 0) return top;

  const otherPercent = Math.round(rest.reduce((sum, l) => sum + l.percent, 0) * 10) / 10;
  return [...top, { language: 'Otros', percent: otherPercent }];
}
