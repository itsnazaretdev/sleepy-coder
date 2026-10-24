import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { consoleLogLines, emptyLinks, huntStaticTasks, isUnsafeBlankTarget, locateTask, unsafeBlankTargets } from '../src/index.js';

let root = '';

async function fixture(files: Record<string, string>) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-rules-')));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

const LAYOUT = (head: string) => `---
const { title } = Astro.props;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
${head}
  </head>
  <body><slot /></body>
</html>
`;

const page = (body = '<p>Hi</p>') => `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Home">
  ${body}
</Layout>
`;

describe('<title> and meta description', () => {
  it('finds them missing in the shared layout, as one task per problem', async () => {
    await fixture({
      'src/layouts/Layout.astro': LAYOUT(''),
      'src/pages/index.astro': page(),
      'src/pages/about.astro': page(),
    });
    const { drafts } = await huntStaticTasks(root);
    const head = drafts.filter((d) => d.fingerprint.startsWith('markup:title') || d.fingerprint.startsWith('markup:meta'));

    expect(head.map((d) => [d.title, d.affectedFiles])).toEqual([
      ['Add a `<title>` in `Layout.astro`', ['src/layouts/Layout.astro']],
      ['Add a meta description in `Layout.astro`', ['src/layouts/Layout.astro']],
    ]);
    expect(head[0]!.description).toContain('2 pages');

    const [location] = await locateTask(root, head[0]!);
    expect(location).toMatchObject({ path: 'src/layouts/Layout.astro', line: 5, note: '`<head>` without `<title>`' });
  });

  it('accepts a title and description set from props or in another component', async () => {
    await fixture({
      'src/components/Seo.astro': '<title>{title}</title>\n<meta content={d} name="description" />\n',
      'src/layouts/Layout.astro': `---\nimport Seo from '../components/Seo.astro';\n---\n${LAYOUT('    <Seo />')}`,
      'src/pages/index.astro': page(),
    });
    const { drafts } = await huntStaticTasks(root);
    expect(drafts.filter((d) => d.category === 'seo')).toEqual([]);
  });

  it('ignores partials that do not render <html>', async () => {
    await fixture({ 'src/pages/fragment.astro': '<p>Only a fragment</p>\n' });
    const { drafts } = await huntStaticTasks(root);
    expect(drafts.filter((d) => d.category === 'seo')).toEqual([]);
  });
});

describe('links', () => {
  it('counts links without readable text', () => {
    const template = `
      <a href="/gh"><svg viewBox="0 0 1 1"><path d="M0" /></svg></a>
      <a href="/ok">Home</a>
      <a href="/label" aria-label="GitHub"><svg /></a>
      <a href="/img"><img src="x.png" alt="Logo"></a>
      <a href="/img2"><img src="x.png" alt=""></a>
      <a href={url}>{name}</a>
      <a href="/svg"><svg><title>Mail</title></svg></a>`;
    expect(emptyLinks(template)).toBe(2);
  });

  it('detects target="_blank" without rel noopener', () => {
    expect(isUnsafeBlankTarget('<a href="x" target="_blank">')).toBe(true);
    expect(isUnsafeBlankTarget('<a href="x" target="_blank" rel="noreferrer">')).toBe(false);
    expect(isUnsafeBlankTarget('<a target=\'_blank\' rel="noopener noreferrer">')).toBe(false);
    expect(unsafeBlankTargets('<a href="a">x</a><a target="_blank" href="b">y</a>')).toBe(1);
  });

  it('turns them into tasks with exact locations', async () => {
    await fixture({
      'src/layouts/Layout.astro': LAYOUT('    <title>{title}</title>\n    <meta name="description" content="x" />'),
      'src/components/Footer.astro': '<footer>\n  <a href="https://github.com/naza" target="_blank"><svg /></a>\n</footer>\n',
    });
    const { drafts } = await huntStaticTasks(root);
    const titles = drafts.filter((d) => d.category === 'seo').map((d) => d.title);
    expect(titles).toEqual([
      'Give a link an accessible text in `Footer.astro`',
      'Add `rel="noopener noreferrer"` to a link with `target="_blank"` in `Footer.astro`',
    ]);

    for (const task of drafts.filter((d) => d.category === 'seo')) {
      const [location] = await locateTask(root, task);
      expect(location?.line).toBe(2);
    }
  });
});

describe('console.log', () => {
  it('finds calls outside comments', () => {
    expect(consoleLogLines("console.log('a');\n// console.log('b');\nfoo(); console.log(x)\n/* console.log */\n")).toEqual([1, 3]);
  });

  it('only checks front-end source files', async () => {
    await fixture({
      'src/components/Gallery.astro': "<script>\n  const x = 1;\n  console.log('debug', x);\n</script>\n",
      'src/server/index.ts': "console.log('listening');\n",
      'src/utils/format.test.ts': 'console.log(1);\n',
      'scripts/build.js': 'console.log(1);\n',
      'astro.config.mjs': 'console.log(1);\n',
    });
    const { drafts } = await huntStaticTasks(root);
    const logs = drafts.filter((d) => d.fingerprint.startsWith('code:console-log'));

    expect(logs.map((d) => d.title)).toEqual(['Remove a leftover `console.log` in `Gallery.astro`']);
    expect(logs[0]!.description).toContain('line 3');
    const [location] = await locateTask(root, logs[0]!);
    expect(location).toMatchObject({ line: 3, note: '`console.log`' });
  });
});
