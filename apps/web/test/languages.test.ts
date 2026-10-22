import { describe, expect, it } from 'vitest';
import type { LanguageStat } from '@sleepy-coder/shared';
import { groupLanguages } from '../src/lib/languages';

const stat = (language: string, percent: number): LanguageStat => ({ language, files: 1, bytes: 1, percent });

describe('groupLanguages', () => {
  it('returns all languages when there are few', () => {
    expect(groupLanguages([stat('TypeScript', 80), stat('CSS', 20)])).toEqual([
      { language: 'TypeScript', percent: 80 },
      { language: 'CSS', percent: 20 },
    ]);
  });

  it('merges the tail into "Other"', () => {
    const input = [stat('A', 50), stat('B', 30), stat('C', 10.1), stat('D', 6.2), stat('E', 3.7)];

    expect(groupLanguages(input, 2)).toEqual([
      { language: 'A', percent: 50 },
      { language: 'B', percent: 30 },
      { language: 'Other', percent: 20 },
    ]);
  });

  it('handles an empty list', () => {
    expect(groupLanguages([])).toEqual([]);
  });
});
