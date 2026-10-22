import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDirectory } from '@sleepy-coder/analyzer';
import { buildRepositoryContext, suggestTasks, SUGGESTION_SCHEMA, type ModelMessage, type TaskModel } from '../src/index.js';

let root = '';

async function fixture(files: Record<string, string>) {
  root = await mkdtemp(join(tmpdir(), 'sleepy-ai-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

/** Fake model that records what it was asked and answers with `answer`. */
function fakeModel(answer: unknown) {
  const calls: Array<{ messages: ModelMessage[]; schema: Record<string, unknown> }> = [];
  const model: TaskModel = {
    async complete(messages, schema) {
      calls.push({ messages, schema });
      return typeof answer === 'string' ? answer : JSON.stringify(answer);
    },
  };
  return { model, calls };
}

describe('buildRepositoryContext', () => {
  it('excerpts the biggest non-test source files within the budget', async () => {
    await fixture({
      'src/big.ts': 'a'.repeat(5_000),
      'src/medium.ts': 'b'.repeat(1_000),
      'src/small.ts': 'c'.repeat(400),
      'src/big.test.ts': 'd'.repeat(9_000),
      'README.md': 'e'.repeat(9_000),
    });
    const { files } = await scanDirectory(root);
    const context = await buildRepositoryContext(root, files, { maxExcerptChars: 2_000, totalBudgetChars: 3_400 });

    expect(context.excerpts.map((e) => [e.path, e.content.length, e.truncated])).toEqual([
      ['src/big.ts', 2_000, true],
      ['src/medium.ts', 1_000, false],
      // 400 chars left: small.ts fits exactly.
      ['src/small.ts', 400, false],
    ]);
    expect([...context.knownFiles].sort()).toEqual(['src/big.test.ts', 'src/big.ts', 'src/medium.ts', 'src/small.ts']);
  });

  it('lists a limited number of files and counts the rest', async () => {
    await fixture(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.ts`, 'x'])));
    const { files } = await scanDirectory(root);
    const context = await buildRepositoryContext(root, files, { maxListedFiles: 3 });

    expect(context.fileList).toEqual(['f0.ts', 'f1.ts', 'f2.ts']);
    expect(context.omittedFiles).toBe(2);
  });
});

describe('suggestTasks', () => {
  it('sends code, file list and known tasks to the model, with the JSON schema', async () => {
    await fixture({ 'src/form.ts': 'export function submit() { /* long function */ }' });
    const { model, calls } = fakeModel({ tasks: [] });

    await suggestTasks(root, model, { knownTitles: ['Añadir una licencia'] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.schema).toBe(SUGGESTION_SCHEMA);
    const user = calls[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('### src/form.ts');
    expect(user).toContain('export function submit()');
    expect(user).toContain('- Añadir una licencia');
    expect(user).toContain('Spanish');
  });

  it('returns validated drafts', async () => {
    await fixture({ 'src/form.ts': 'export const x = 1;' });
    const { model } = fakeModel({
      tasks: [
        {
          title: 'Renombrar la constante x',
          description: 'x no dice qué representa.',
          category: 'refactor',
          priority: 'low',
          complexity: 'small',
          risk: 'low',
          affectedFiles: ['src/form.ts', 'src/nope.ts'],
          suggestedImplementation: 'Usa un nombre descriptivo.',
        },
      ],
    });

    const { drafts } = await suggestTasks(root, model);
    expect(drafts.map((d) => [d.title, d.source, d.affectedFiles])).toEqual([
      ['Renombrar la constante x', 'ai', ['src/form.ts']],
    ]);
  });

  it('does not call the model when there is no source code', async () => {
    await fixture({ 'README.md': '# only docs' });
    const { model, calls } = fakeModel({ tasks: [] });

    expect(await suggestTasks(root, model)).toEqual({ drafts: [], skipped: 0 });
    expect(calls).toHaveLength(0);
  });
});
