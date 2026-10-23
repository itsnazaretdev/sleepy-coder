import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectTestCommand, linkDependencies, packageManagerFor, runTests } from '../src/index.js';

let dir = '';

const pkg = (scripts: Record<string, string>) => writeFile(join(dir, 'package.json'), JSON.stringify({ scripts }));

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-runner-')));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('detectTestCommand', () => {
  it('uses the package manager of the lockfile', async () => {
    await pkg({ test: 'vitest run' });
    expect(await detectTestCommand(dir)).toEqual({ file: 'npm', args: ['test'], display: 'npm test' });

    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    expect(await detectTestCommand(dir)).toEqual({ file: 'pnpm', args: ['test'], display: 'pnpm test' });
  });

  it('runs the script, not Bun’s own runner, for Bun projects', async () => {
    await pkg({ test: 'vitest' });
    await writeFile(join(dir, 'bun.lockb'), '');
    expect((await detectTestCommand(dir))?.display).toBe('bun run test');
  });

  it('returns null without package.json, without a test script, or with npm’s placeholder', async () => {
    expect(await detectTestCommand(dir)).toBeNull();
    await pkg({ build: 'astro build' });
    expect(await detectTestCommand(dir)).toBeNull();
    await pkg({ test: 'echo "Error: no test specified" && exit 1' });
    expect(await detectTestCommand(dir)).toBeNull();
  });

  it('detects yarn', async () => {
    await writeFile(join(dir, 'yarn.lock'), '');
    expect(packageManagerFor(dir)).toBe('yarn');
  });
});

describe('runTests', () => {
  const npmTest = { file: 'npm', args: ['test', '--silent'], display: 'npm test' };

  it('reports passing tests', async () => {
    await pkg({ test: 'node -e "console.log(\'all good\')"' });
    const result = await runTests(dir, npmTest);

    expect(result).toMatchObject({ command: 'npm test', passed: true, exitCode: 0, timedOut: false });
    expect(result.output).toContain('all good');
  });

  it('reports failing tests with their output', async () => {
    await pkg({ test: 'node -e "console.error(\'1 test failed\'); process.exit(1)"' });
    const result = await runTests(dir, npmTest);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('1 test failed');
  });

  it('stops tests that take too long', async () => {
    await pkg({ test: 'node -e "setTimeout(() => {}, 10000)"' });
    const result = await runTests(dir, npmTest, { timeoutMs: 500 });

    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain('stopped after');
  });

  it('runs tests with CI=1 so runners do not stay in watch mode', async () => {
    await pkg({ test: 'node -e "console.log(\'CI=\' + process.env.CI)"' });
    expect((await runTests(dir, npmTest)).output).toContain('CI=1');
  });

  it('explains when the package manager is not installed', async () => {
    const result = await runTests(dir, { file: 'definitely-not-a-pm', args: ['test'], display: 'x test' });
    expect(result.passed).toBe(false);
    expect(result.output).toContain('not installed');
  });
});

describe('linkDependencies', () => {
  it('links node_modules from the source checkout into matching folders of the worktree', async () => {
    const source = join(dir, 'source');
    const target = join(dir, 'target');
    for (const p of ['node_modules/vitest', 'apps/web/node_modules/astro', 'apps/api/src', 'packages/x/node_modules/y']) {
      await mkdir(join(source, p), { recursive: true });
    }
    await mkdir(join(target, 'apps', 'web'), { recursive: true }); // apps/api and packages/x do not exist there

    const linked = await linkDependencies(source, target);

    expect(linked).toEqual(['apps/web/node_modules', 'node_modules']);
    expect((await lstat(join(target, 'node_modules'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(target, 'apps/web/node_modules'))).toBe(join(source, 'apps/web/node_modules'));
    expect(existsSync(join(target, 'packages'))).toBe(false);
  });

  it('does not replace an existing node_modules', async () => {
    const source = join(dir, 'source');
    const target = join(dir, 'target');
    await mkdir(join(source, 'node_modules'), { recursive: true });
    await mkdir(join(target, 'node_modules'), { recursive: true });

    expect(await linkDependencies(source, target)).toEqual([]);
  });
});
