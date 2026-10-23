import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiOutputError, buildGuideMessages, MAX_GUIDE_STEPS, parseGuide, writeFixGuide, type LocatableTask } from '../src/index.js';

const TASK: LocatableTask = {
  source: 'static',
  category: 'seo',
  title: 'Fix duplicate `<h1>` caused by `PreviewSite.astro`',
  description: 'The main title is the `<h1>` in `src/components/Hero.astro`.',
  suggestedImplementation: 'Keep the `<h1>` in `src/components/Hero.astro`: do not change it.',
  affectedFiles: ['src/components/PreviewSite.astro'],
};

describe('parseGuide', () => {
  it('keeps explanation, steps and suggestions for the task files', () => {
    const raw = JSON.stringify({
      explanation: ' The preview adds a second heading. ',
      steps: ['Open the file', '', 'Change the tag'],
      suggestions: [
        { path: './src/components/PreviewSite.astro', code: '<p class="fake-title">My website</p>' },
        { path: 'src/other.ts', code: 'x' },
      ],
    });
    expect(parseGuide(raw, ['src/components/PreviewSite.astro', 'src/b.ts'])).toEqual({
      applies: true,
      explanation: 'The preview adds a second heading.',
      steps: ['Open the file', 'Change the tag'],
      suggestions: [{ path: 'src/components/PreviewSite.astro', code: '<p class="fake-title">My website</p>' }],
    });
  });

  it('with a single file, a wrong path means that file; fences and line numbers are removed', () => {
    const raw = JSON.stringify({
      explanation: 'x',
      steps: [],
      suggestions: [{ path: 'PreviewSite.astro', code: '```astro\n   7 | <p>Hi</p>\n   8 | </header>\n```' }],
    });
    expect(parseGuide(raw, ['src/components/PreviewSite.astro']).suggestions).toEqual([
      { path: 'src/components/PreviewSite.astro', code: '<p>Hi</p>\n</header>' },
    ]);
  });

  it('lets the model say the task does not apply, and then drops steps and code', () => {
    const raw = JSON.stringify({
      applies: false,
      explanation: 'Every background already has a description.',
      steps: ['Open the file'],
      suggestions: [{ path: 'src/data/seo.js', code: "description: 'x'" }],
    });
    expect(parseGuide(raw, ['src/data/seo.js'])).toEqual({
      applies: false,
      explanation: 'Every background already has a description.',
      steps: [],
      suggestions: [],
    });
  });

  it('caps the number of steps', () => {
    const raw = JSON.stringify({ explanation: 'x', steps: Array.from({ length: 10 }, (_, i) => `step ${i}`), suggestions: [] });
    expect(parseGuide(raw, []).steps).toHaveLength(MAX_GUIDE_STEPS);
  });

  it('throws for answers without content', () => {
    expect(() => parseGuide('not json', [])).toThrow(AiOutputError);
    expect(() => parseGuide('{"explanation":"","steps":[],"suggestions":[]}', [])).toThrow(AiOutputError);
  });
});

describe('writeFixGuide', () => {
  let root = '';

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-guide-')));
    await mkdir(join(root, 'src/components'), { recursive: true });
    await writeFile(join(root, 'src/components/PreviewSite.astro'), '<div>\n  <h1 class="fake-title">My website</h1>\n</div>\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shows the model the numbered lines and the hint, and never writes files', async () => {
    let prompt = '';
    const model = {
      async complete(messages: Array<{ content: string }>) {
        prompt = messages[1]!.content;
        return JSON.stringify({
          explanation: 'Change the preview heading.',
          steps: ['In `src/components/PreviewSite.astro` line 2, change `<h1>` to `<p>`.'],
          suggestions: [{ path: 'src/components/PreviewSite.astro', code: '<p class="fake-title">My website</p>' }],
        });
      },
    };

    const guide = await writeFixGuide(root, TASK, model);

    expect(prompt).toContain('problem at line 2');
    expect(prompt).toContain('   2 |   <h1 class="fake-title">My website</h1>');
    expect(prompt).toContain('do not change it');
    expect(guide.suggestions).toHaveLength(1);
    expect(await readFile(join(root, 'src/components/PreviewSite.astro'), 'utf8')).toContain('<h1');
  });

  it('shows the model the real file for AI tasks without an exact line, so it can reject wrong tasks', async () => {
    await mkdir(join(root, 'src/data'), { recursive: true });
    await writeFile(
      join(root, 'src/data/seo.js'),
      "export const seo = {\n  nebula: {\n    description: 'A CSS nebula background.',\n  },\n};\n",
    );
    let prompt = '';
    const model = {
      async complete(messages: Array<{ content: string }>) {
        prompt = messages[1]!.content;
        return JSON.stringify({ applies: false, explanation: 'The descriptions are not empty.', steps: [], suggestions: [] });
      },
    };
    const aiTask: LocatableTask = {
      source: 'ai',
      category: 'documentation',
      title: 'Fill the empty SEO descriptions',
      description: 'All the descriptions in the SEO file are empty strings.',
      suggestedImplementation: 'Write a description for each background.',
      affectedFiles: ['src/data/seo.js'],
    };

    const guide = await writeFixGuide(root, aiTask, model);

    expect(prompt).toContain('### src/data/seo.js — current content');
    expect(prompt).toContain("   3 |     description: 'A CSS nebula background.',");
    expect(prompt).toContain('applies: false');
    expect(guide.applies).toBe(false);
  });

  it('tells the model when a file does not exist yet', () => {
    const [, user] = buildGuideMessages(TASK, [
      { path: 'LICENSE', absolutePath: '/r/LICENSE', line: null, exists: false, note: 'File to create', snippet: '', snippetStart: 1 },
    ]);
    expect(user!.content).toContain('(this file does not exist yet)');
  });
});
