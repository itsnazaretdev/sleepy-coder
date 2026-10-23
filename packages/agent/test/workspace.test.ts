import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  normalizeRelativePath,
  openWorkspace,
  protectedReason,
  WorkspaceError,
  type Workspace,
} from '../src/index.js';

let sandbox = '';
let root = '';
let outside = '';
let ws: Workspace;

async function code(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-ws-')));
  root = join(sandbox, 'repo');
  outside = join(sandbox, 'secret');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'package.json'), '{"scripts":{"test":"vitest"}}');
  await writeFile(join(outside, 'passwords.txt'), 'hunter2');
  ws = await openWorkspace(root);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('normalizeRelativePath', () => {
  it('cleans harmless variations', () => {
    expect(normalizeRelativePath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizeRelativePath('src\\a.ts')).toBe('src/a.ts');
    expect(normalizeRelativePath('  src/a.ts ')).toBe('src/a.ts');
  });

  it.each(['', '   ', '.', '/etc/passwd', '~/.ssh/id_rsa', 'C:\\Windows', '../secret', 'src/../../secret', 'a\u0000b', 'a\nb'])(
    'rejects %j',
    (path) => {
      expect(() => normalizeRelativePath(path)).toThrow(WorkspaceError);
    },
  );
});

describe('protectedReason', () => {
  it.each([
    'package.json',
    'apps/web/package.json',
    'pnpm-lock.yaml',
    '.npmrc',
    '.env',
    '.env.local',
    '.github/workflows/ci.yml',
    '.husky/pre-commit',
    'vitest.config.ts',
    'apps/web/astro.config.mjs',
    'eslint.config.js',
    '.eslintrc.cjs',
    '.git/config',
    'node_modules/x/index.js',
  ])('protects %s', (path) => {
    expect(protectedReason(path)).not.toBeNull();
  });

  it.each(['src/a.ts', 'src/config.ts', 'README.md', 'LICENSE', 'test/a.test.ts', 'src/components/Nav.astro'])(
    'allows %s',
    (path) => {
      expect(protectedReason(path)).toBeNull();
    },
  );
});

describe('readFile', () => {
  it('reads text files inside the workspace', async () => {
    expect(await ws.readFile('src/a.ts')).toContain('export const a');
    expect(await ws.readFile('package.json')).toContain('vitest'); // reading is fine, writing is not
  });

  it('cannot escape with ".." or absolute paths', async () => {
    expect(await code(ws.readFile('../secret/passwords.txt'))).toBe('invalid-path');
    expect(await code(ws.readFile(join(outside, 'passwords.txt')))).toBe('invalid-path');
  });

  it('cannot escape through a symlinked file or folder', async () => {
    await symlink(join(outside, 'passwords.txt'), join(root, 'link.txt'));
    await symlink(outside, join(root, 'linkdir'));

    expect(await code(ws.readFile('link.txt'))).toBe('outside-workspace');
    expect(await code(ws.readFile('linkdir/passwords.txt'))).toBe('outside-workspace');
  });

  it('cannot read inside .git or node_modules', async () => {
    expect(await code(ws.readFile('.git/config'))).toBe('protected-path');
    expect(await code(ws.readFile('node_modules/x/index.js'))).toBe('protected-path');
  });

  it('reports missing, too large and binary files', async () => {
    await writeFile(join(root, 'big.txt'), 'x'.repeat(MAX_READ_BYTES + 1));
    await writeFile(join(root, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]));

    expect(await code(ws.readFile('missing.ts'))).toBe('not-found');
    expect(await code(ws.readFile('big.txt'))).toBe('too-large');
    expect(await code(ws.readFile('image.bin'))).toBe('binary-file');
    expect(await code(ws.readFile('src'))).toBe('not-a-file');
  });
});

describe('writeFile', () => {
  it('writes and creates folders inside the workspace, and remembers what changed', async () => {
    expect(await ws.writeFile('src/a.ts', 'export const a = 2;\n')).toEqual({ path: 'src/a.ts', created: false });
    expect(await ws.writeFile('test/new/a.test.ts', 'test')).toEqual({ path: 'test/new/a.test.ts', created: true });

    expect(await readFile(join(root, 'test/new/a.test.ts'), 'utf8')).toBe('test');
    expect([...ws.written].sort()).toEqual(['src/a.ts', 'test/new/a.test.ts']);
  });

  it('refuses protected files and leaves them untouched', async () => {
    expect(await code(ws.writeFile('package.json', '{"scripts":{"test":"rm -rf ~"}}'))).toBe('protected-path');
    expect(await code(ws.writeFile('vitest.config.ts', 'export default {}'))).toBe('protected-path');
    expect(await code(ws.writeFile('.github/workflows/x.yml', 'on: push'))).toBe('protected-path');
    expect(await readFile(join(root, 'package.json'), 'utf8')).toContain('vitest');
  });

  it('cannot write outside, not even through a symlinked folder', async () => {
    await symlink(outside, join(root, 'linkdir'));

    expect(await code(ws.writeFile('../secret/x.txt', 'x'))).toBe('invalid-path');
    expect(await code(ws.writeFile('linkdir/x.txt', 'x'))).toBe('outside-workspace');
    expect(await code(ws.writeFile('linkdir/deep/x.txt', 'x'))).toBe('outside-workspace');
  });

  it('does not write through a symlinked file', async () => {
    await symlink(join(outside, 'passwords.txt'), join(root, 'link.txt'));
    expect(await code(ws.writeFile('link.txt', 'pwned'))).toBe('outside-workspace');
    expect(await readFile(join(outside, 'passwords.txt'), 'utf8')).toBe('hunter2');
  });

  it('refuses binary and oversized content', async () => {
    expect(await code(ws.writeFile('a.txt', 'a\u0000b'))).toBe('binary-file');
    expect(await code(ws.writeFile('a.txt', 'x'.repeat(MAX_WRITE_BYTES + 1)))).toBe('too-large');
  });
});

describe('listFiles', () => {
  it('lists repository files without .git or node_modules', async () => {
    await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'x', 'i.js'), '');
    expect(await ws.listFiles()).toEqual(['package.json', 'src/a.ts']);
  });
});
