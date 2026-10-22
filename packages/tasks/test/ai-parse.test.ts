import { describe, expect, it } from 'vitest';
import { AiOutputError, MAX_AI_TASKS, normalizeTitle, parseSuggestions } from '../src/index.js';

const knownFiles = new Set(['src/form.ts', 'src/api.ts']);

const suggestion = (overrides: Record<string, unknown> = {}) => ({
  title: 'Extraer la validación del formulario',
  description: 'La función submit mezcla validación y envío.',
  category: 'refactor',
  priority: 'medium',
  complexity: 'small',
  risk: 'low',
  affectedFiles: ['src/form.ts'],
  suggestedImplementation: 'Crea validateForm() y llámala desde submit().',
  ...overrides,
});

const parse = (raw: unknown, knownTitles: string[] = []) =>
  parseSuggestions(typeof raw === 'string' ? raw : JSON.stringify(raw), { knownFiles, knownTitles });

describe('normalizeTitle', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeTitle('  Extraer la VALIDACIÓN, ¡ya!  ')).toBe('extraer la validacion ya');
  });
});

describe('parseSuggestions', () => {
  it('turns a valid answer into AI task drafts', () => {
    const { drafts, skipped } = parse({ tasks: [suggestion()] });

    expect(skipped).toBe(0);
    expect(drafts).toEqual([
      {
        fingerprint: 'ai:extraer la validacion del formulario',
        source: 'ai',
        title: 'Extraer la validación del formulario',
        description: 'La función submit mezcla validación y envío.',
        category: 'refactor',
        priority: 'medium',
        complexity: 'small',
        risk: 'low',
        affectedFiles: ['src/form.ts'],
        suggestedImplementation: 'Crea validateForm() y llámala desde submit().',
      },
    ]);
  });

  it('accepts a bare array and ```json fences', () => {
    const fenced = '```json\n' + JSON.stringify([suggestion()]) + '\n```';
    expect(parse(fenced).drafts).toHaveLength(1);
  });

  it('throws AiOutputError for text that is not JSON', () => {
    expect(() => parse('Here are some ideas: ...')).toThrow(AiOutputError);
  });

  it('throws AiOutputError when there is no task list', () => {
    expect(() => parse({ ideas: [] })).toThrow(AiOutputError);
  });

  it('returns nothing for an empty list', () => {
    expect(parse({ tasks: [] })).toEqual({ drafts: [], skipped: 0 });
  });

  it('replaces unknown enum values with safe defaults', () => {
    const [draft] = parse({
      tasks: [suggestion({ category: 'todo', priority: 'URGENT', complexity: 'tiny', risk: 'HIGH' })],
    }).drafts;

    expect(draft).toMatchObject({ category: 'maintenance', priority: 'medium', complexity: 'medium', risk: 'high' });
  });

  it('removes invented files and normalizes "./" paths', () => {
    const [draft] = parse({
      tasks: [suggestion({ affectedFiles: ['./src/api.ts', 'src/invented.ts', '/src/form.ts', 'src/api.ts'] })],
    }).drafts;

    expect(draft?.affectedFiles).toEqual(['src/api.ts', 'src/form.ts']);
  });

  it('skips tasks without a usable title or description', () => {
    const result = parse({
      tasks: [suggestion({ title: '' }), suggestion({ title: 'x'.repeat(200) }), suggestion({ description: '  ' }), 42],
    });
    expect(result).toEqual({ drafts: [], skipped: 4 });
  });

  it('skips repeated and already known titles', () => {
    const result = parse(
      {
        tasks: [
          suggestion(),
          suggestion({ title: 'EXTRAER la validacion del formulario!' }),
          suggestion({ title: 'Añadir una licencia' }),
        ],
      },
      ['Añadir una licencia'],
    );

    expect(result.drafts.map((d) => d.title)).toEqual(['Extraer la validación del formulario']);
    expect(result.skipped).toBe(2);
  });

  it(`keeps at most ${MAX_AI_TASKS} tasks`, () => {
    const many = Array.from({ length: 9 }, (_, i) => suggestion({ title: `Tarea número ${i + 1}` }));
    const result = parse({ tasks: many });

    expect(result.drafts).toHaveLength(MAX_AI_TASKS);
    expect(result.skipped).toBe(9 - MAX_AI_TASKS);
  });

  it('falls back to the description when there is no implementation hint', () => {
    const [draft] = parse({ tasks: [suggestion({ suggestedImplementation: undefined })] }).drafts;
    expect(draft?.suggestedImplementation).toBe('La función submit mezcla validación y envío.');
  });
});
