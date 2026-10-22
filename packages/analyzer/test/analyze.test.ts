import { afterEach, describe, expect, it } from 'vitest';
import { analyzeStructure, isTestFile } from '../src/index.js';
import { createFixture, removeFixture } from './helpers.js';

let root = '';

afterEach(async () => {
  if (root) await removeFixture(root);
  root = '';
});

describe('isTestFile', () => {
  it.each([
    'src/utils.test.ts',
    'src/button.spec.jsx',
    'test/health.ts',
    'src/__tests__/a.js',
    'src/test/java/LibroTest.java',
    'pkg/db_test.go',
    'tests/test_api.py',
  ])('detects %s', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each(['src/index.ts', 'src/testing.ts', 'docs/test.md'])('ignores %s', (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe('analyzeStructure', () => {
  it('detects a pnpm + Astro + React monorepo with Vitest', async () => {
    root = await createFixture({
      'package.json': JSON.stringify({ name: 'demo', devDependencies: { typescript: '5' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'apps/web/package.json': JSON.stringify({ dependencies: { astro: '5', react: '19' } }),
      'apps/server/package.json': JSON.stringify({
        dependencies: { fastify: '5' },
        devDependencies: { vitest: '3' },
      }),
      'apps/server/test/health.test.ts': "import { it } from 'vitest';\nit('works', () => {});\n",
      'apps/web/src/index.astro': '<h1>hi</h1>',
      'tsconfig.json': '{}',
      '.github/workflows/ci.yml': 'on: push',
      'README.md': '# Demo',
      'node_modules/react/package.json': JSON.stringify({ dependencies: { next: '1' } }),
    });

    const report = await analyzeStructure(root);

    expect(report.packageManagers).toEqual(['pnpm']);
    expect(report.frameworks).toEqual(['Astro', 'Fastify', 'React']);
    expect(report.testingTools).toEqual(['Vitest']);
    expect(report.configFiles).toEqual(['GitHub Actions', 'TypeScript']);
    expect(report.files.testFiles).toBe(1);
    expect(report.hasReadme).toBe(true);
    expect(report.hasLicense).toBe(false);
    expect(report.languages.map((l) => l.language)).toEqual(['TypeScript', 'Astro']);
  });

  it('detects a Maven Swing project with JUnit', async () => {
    root = await createFixture({
      'pom.xml': '<project><dependency><artifactId>junit-jupiter</artifactId></dependency></project>',
      'src/main/java/app/Main.java': 'package app;\n\nimport javax.swing.JFrame;\n\npublic class Main {}',
      'src/test/java/app/MainTest.java': 'class MainTest {}',
      LICENSE: 'MIT',
    });

    const report = await analyzeStructure(root);

    expect(report.packageManagers).toEqual(['Maven']);
    expect(report.frameworks).toEqual(['Swing']);
    expect(report.testingTools).toEqual(['JUnit']);
    expect(report.files.testFiles).toBe(1);
    expect(report.hasLicense).toBe(true);
    expect(report.languages[0]?.language).toBe('Java');
  });

  it('survives an invalid package.json', async () => {
    root = await createFixture({ 'package.json': '{ not json', 'index.js': 'x' });
    const report = await analyzeStructure(root);

    expect(report.frameworks).toEqual([]);
    expect(report.files.total).toBe(2);
  });

  it('handles an empty folder', async () => {
    root = await createFixture({});
    const report = await analyzeStructure(root);

    expect(report.files).toEqual({ total: 0, totalBytes: 0, testFiles: 0, truncated: false });
    expect(report.languages).toEqual([]);
  });
});
