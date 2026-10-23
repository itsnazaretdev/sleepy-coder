import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeNames, huntStaticTasks, locateTask, type LocatableTask } from '../src/index.js';

const PREVIEW = `---
const { bg } = Astro.props;
---
<!-- <h1>old title</h1> -->
<div class="fake-site">
  <header class="fake-nav">
    <h1 class="fake-title">My website</h1>
  </header>
  <p>Lorem ipsum</p>
</div>
`;

const HERO = `<section class="hero">\n  <h1>CSS backgrounds</h1>\n</section>\n`;

const PAGE = `---
import Hero from '../components/Hero.astro';
import PreviewSite from '../components/PreviewSite.astro';
---
<html lang="en">
  <body>
    <Hero />
    <PreviewSite />
    <img src="/a.png">
    <img src="/b.png" alt="B">
  </body>
</html>
`;

describe('locateTask', () => {
  let root = '';

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-locate-')));
    await mkdir(join(root, 'src/components'), { recursive: true });
    await mkdir(join(root, 'src/pages'), { recursive: true });
    await writeFile(join(root, 'src/components/PreviewSite.astro'), PREVIEW);
    await writeFile(join(root, 'src/components/Hero.astro'), HERO);
    await writeFile(join(root, 'src/pages/index.astro'), PAGE);
    await writeFile(join(root, 'src/upload.ts'), 'const a = 1;\n// TODO: validate size\nexport function handleUpload() {}\n');
    await writeFile(join(root, 'README.md'), '# x');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('points at the extra <h1> (not the commented one, not the hero)', async () => {
    const { drafts } = await huntStaticTasks(root);
    const task = drafts.find((d) => d.title.includes('`<h1>`'))!;
    const locations = await locateTask(root, task);

    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      path: 'src/components/PreviewSite.astro',
      absolutePath: join(root, 'src/components/PreviewSite.astro'),
      line: 7,
      exists: true,
      note: 'Extra `<h1>`',
      snippetStart: 4,
    });
    expect(locations[0]!.snippet).toContain('<h1 class="fake-title">My website</h1>');
  });

  it('points at each <img> without alt', async () => {
    const { drafts } = await huntStaticTasks(root);
    const task = drafts.find((d) => d.title.includes('`alt`'))!;
    const locations = await locateTask(root, task, { contextLines: 0 });
    expect(locations.map((l) => [l.line, l.snippet.trim()])).toEqual([[9, '<img src="/a.png">']]);
  });

  it('finds a TODO comment even if it moved', async () => {
    const { drafts } = await huntStaticTasks(root);
    const task = drafts.find((d) => d.category === 'todo')!;
    await writeFile(join(root, 'src/upload.ts'), '\n\nconst a = 1;\n// TODO: validate size\n');
    const [location] = await locateTask(root, task);
    expect(location).toMatchObject({ line: 4, note: 'TODO comment' });
  });

  it('marks files that do not exist yet as files to create', async () => {
    const task: LocatableTask = {
      source: 'static',
      category: 'documentation',
      title: 'Add a license',
      description: 'There is no LICENSE file.',
      suggestedImplementation: 'Add a `LICENSE` file.',
      affectedFiles: ['LICENSE'],
    };
    expect(await locateTask(root, task)).toEqual([
      {
        path: 'LICENSE',
        absolutePath: join(root, 'LICENSE'),
        line: null,
        exists: false,
        note: 'File to create',
        snippet: '',
        snippetStart: 1,
      },
    ]);
  });

  it('finds the code names an AI task mentions', async () => {
    const task: LocatableTask = {
      source: 'ai',
      category: 'refactor',
      title: 'Validate files in `handleUpload`',
      description: '`handleUpload()` accepts any file.',
      suggestedImplementation: 'Check the size in `src/upload.ts`.',
      affectedFiles: ['src/upload.ts', 'src/missing.ts', '../etc/passwd'],
    };
    const locations = await locateTask(root, task);
    expect(locations.map((l) => [l.path, l.line, l.note])).toEqual([
      ['src/upload.ts', 3, '`handleUpload`'],
      ['src/missing.ts', null, 'File to create'],
    ]);
  });

  it('extracts identifiers only', () => {
    expect(
      codeNames({
        source: 'ai',
        category: 'refactor',
        title: 'Use `menu.items` and `<h1>` in `src/a.ts`',
        description: 'Call `load()` — `not an identifier`',
        suggestedImplementation: '',
        affectedFiles: ['src/a.ts'],
      }),
    ).toEqual(['menu.items', 'load']);
  });
});
