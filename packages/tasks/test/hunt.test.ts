import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { huntStaticTasks } from '../src/index.js';

let root = '';

async function fixture(files: Record<string, string>) {
  root = await mkdtemp(join(tmpdir(), 'sleepy-tasks-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('huntStaticTasks', () => {
  it('finds report gaps and TODO comments', async () => {
    await fixture({
      'package.json': '{}',
      'src/index.ts': 'export const a = 1; // TODO: rename this\n',
      'src/util.ts': '// FIXME: off by one\nexport const b = 2;\n',
      'docs/notes.md': '- TODO: write docs', // not code: ignored
      'node_modules/lib/index.js': '// TODO: not ours', // ignored folder
    });

    const { drafts, todosTruncated } = await huntStaticTasks(root);

    expect(drafts.map((d) => d.fingerprint)).toEqual([
      'report:no-tests',
      'report:no-readme',
      'report:no-license',
      'todo:src/index.ts:TODO:rename this',
      'todo:src/util.ts:FIXME:off by one',
    ]);
    expect(todosTruncated).toBe(false);
  });

  it('suggests Vitest for a TypeScript project without tests', async () => {
    await fixture({ 'src/index.ts': 'export {}' });
    const { drafts } = await huntStaticTasks(root);
    const testTask = drafts.find((d) => d.fingerprint === 'report:no-tests');

    expect(testTask?.suggestedImplementation).toContain('Vitest');
  });

  it('finds nothing to do in a tidy repository', async () => {
    await fixture({
      'README.md': '# ok',
      LICENSE: 'MIT',
      'src/index.ts': 'export const a = 1;',
      'src/index.test.ts': 'test',
    });

    expect((await huntStaticTasks(root)).drafts).toEqual([]);
  });

  it('does not ask for tests when there is no code at all', async () => {
    await fixture({ 'README.md': '# notes', LICENSE: 'MIT' });
    expect((await huntStaticTasks(root)).drafts).toEqual([]);
  });

  it('keeps only one task for identical comments in the same file', async () => {
    await fixture({
      'README.md': '#',
      LICENSE: 'MIT',
      'a.test.ts': '',
      'a.ts': '// TODO: same\n// TODO: same\n',
    });

    const todos = (await huntStaticTasks(root)).drafts.filter((d) => d.category === 'todo');
    expect(todos).toHaveLength(1);
  });
});
