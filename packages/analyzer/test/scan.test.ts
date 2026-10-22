import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDirectory } from '../src/index.js';
import { createFixture, removeFixture } from './helpers.js';

let root = '';

afterEach(async () => {
  if (root) await removeFixture(root);
  root = '';
});

describe('scanDirectory', () => {
  it('lists files with relative "/" paths and sizes, sorted', async () => {
    root = await createFixture({ 'b.ts': '12345', 'a/c.ts': 'x' });
    const result = await scanDirectory(root);

    expect(result).toEqual({
      files: [
        { path: 'a/c.ts', size: 1 },
        { path: 'b.ts', size: 5 },
      ],
      truncated: false,
    });
  });

  it('skips generated and dependency folders', async () => {
    root = await createFixture({
      'src/index.ts': 'x',
      'node_modules/lib/index.js': 'x',
      '.git/HEAD': 'x',
      'dist/out.js': 'x',
      'apps/web/node_modules/x.js': 'x',
      '.github/workflows/ci.yml': 'x',
    });
    const paths = (await scanDirectory(root)).files.map((f) => f.path);

    expect(paths).toEqual(['.github/workflows/ci.yml', 'src/index.ts']);
  });

  it('skips .DS_Store files', async () => {
    root = await createFixture({ '.DS_Store': 'x', 'a.ts': 'x' });
    expect((await scanDirectory(root)).files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('does not follow symlinks', async () => {
    root = await createFixture({ 'real/a.ts': 'x' });
    await symlink(join(root, 'real'), join(root, 'link'));

    expect((await scanDirectory(root)).files.map((f) => f.path)).toEqual(['real/a.ts']);
  });

  it('stops and flags truncation when maxFiles is reached', async () => {
    root = await createFixture({ 'a.ts': 'x', 'b.ts': 'x', 'c.ts': 'x' });
    const result = await scanDirectory(root, { maxFiles: 2 });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('respects maxDepth', async () => {
    root = await createFixture({ 'top.ts': 'x', 'a/b/deep.ts': 'x' });
    const paths = (await scanDirectory(root, { maxDepth: 1 })).files.map((f) => f.path);

    expect(paths).toEqual(['top.ts']);
  });
});
