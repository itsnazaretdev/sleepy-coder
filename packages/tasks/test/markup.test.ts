import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDirectory } from '@sleepy-coder/analyzer';
import {
  astroImports,
  countH1,
  findMarkupIssues,
  htmlWithoutLang,
  imagesWithoutAlt,
  parseMarkup,
} from '../src/index.js';

let root = '';

async function fixture(files: Record<string, string>) {
  root = await mkdtemp(join(tmpdir(), 'sleepy-markup-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const { files: scanned } = await scanDirectory(root);
  return findMarkupIssues(root, scanned);
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

const LAYOUT_WITH_H1 = `---
const { title } = Astro.props;
---
<html lang="en">
  <body>
    <header><h1 class="logo">Fondos CSS</h1></header>
    <slot />
  </body>
</html>
`;

const page = (layoutImport = '../layouts/Layout.astro', h1 = '<h1>Gallery</h1>') => `---
import Layout from '${layoutImport}';
---
<Layout title="Gallery">
  ${h1}
</Layout>
`;

describe('helpers', () => {
  it('counts <h1> but not <h1x> or text, and ignores comments', () => {
    const { template } = parseMarkup('a.astro', '<h1>A</h1><h1 class="x">B</h1><h10>no</h10><!-- <h1>old</h1> -->{/* <h1>x</h1> */}');
    expect(countH1(template)).toBe(2);
  });

  it('separates the Astro frontmatter from the template', () => {
    const file = parseMarkup('src/pages/a.astro', page());
    expect(file.frontmatter).toContain("import Layout from '../layouts/Layout.astro'");
    expect(file.template).not.toContain('import');
  });

  it('resolves relative and @/ ~/ imports of Astro components', () => {
    const file = parseMarkup(
      'src/pages/blog/post.astro',
      "---\nimport Layout from '../../layouts/Layout.astro';\nimport Card from '@/components/Card.astro';\nimport Nav from '~/components/Nav.astro';\nimport x from 'some-package';\n---\n",
    );
    expect(Object.fromEntries(astroImports(file))).toEqual({
      Layout: 'src/layouts/Layout.astro',
      Card: 'src/components/Card.astro',
      Nav: 'src/components/Nav.astro',
    });
  });

  it('finds images without alt, ignoring spreads', () => {
    expect(imagesWithoutAlt('<img src="a.png"><img src="b.png" alt="B"><img alt="" src="c"><img {...props} />')).toBe(1);
  });

  it('detects <html> without lang', () => {
    expect(htmlWithoutLang('<html><body></body></html>')).toBe(true);
    expect(htmlWithoutLang('<html lang="es">')).toBe(false);
    expect(htmlWithoutLang('<div></div>')).toBe(false);
  });
});

describe('findMarkupIssues', () => {
  it('detects a duplicate <h1> coming from the layout and the page', async () => {
    const tasks = await fixture({
      'src/layouts/Layout.astro': LAYOUT_WITH_H1,
      'src/pages/index.astro': page(),
    });

    const [h1] = tasks.filter((t) => t.fingerprint.startsWith('markup:h1'));
    expect(h1).toMatchObject({
      title: 'Fix duplicate `<h1>` caused by `Layout.astro`',
      category: 'seo',
      priority: 'high',
      // Only the file to change: the page's own <h1> is the main title.
      affectedFiles: ['src/layouts/Layout.astro'],
    });
    expect(h1?.description).toContain('The main title is the `<h1>` in `src/pages/index.astro`');
    expect(h1?.suggestedImplementation).toContain('do not change it');
  });

  it('groups every page broken by the same layout into one task', async () => {
    const tasks = await fixture({
      'src/layouts/Layout.astro': LAYOUT_WITH_H1,
      'src/pages/index.astro': page(),
      'src/pages/about.astro': page('@/layouts/Layout.astro', '<h1>About</h1>'),
      'src/pages/contact.astro': page('../layouts/Layout.astro', '<h2>Contact</h2>'), // fine: only the layout h1
    });

    const h1Tasks = tasks.filter((t) => t.fingerprint.startsWith('markup:h1'));
    expect(h1Tasks).toHaveLength(1);
    expect(h1Tasks[0]?.affectedFiles).toEqual(['src/layouts/Layout.astro']);
    expect(h1Tasks[0]?.description).toContain('`src/pages/about.astro`, `src/pages/index.astro`');
  });

  it('follows nested components (layout → header)', async () => {
    const tasks = await fixture({
      'src/components/Header.astro': '<header><h1>Logo</h1></header>',
      'src/layouts/Layout.astro': "---\nimport Header from '../components/Header.astro';\n---\n<html lang=\"en\"><Header /><slot /></html>",
      'src/pages/index.astro': page(),
    });

    const [h1] = tasks.filter((t) => t.fingerprint.startsWith('markup:h1'));
    expect(h1?.affectedFiles).toEqual(['src/components/Header.astro']);
  });

  it('keeps the Hero <h1> and blames the preview modal (the CSS backgrounds case)', async () => {
    const tasks = await fixture({
      'src/components/Hero.astro': '<section class="hero"><h1 class="hero-title">Fondos CSS</h1></section>',
      'src/components/PreviewSite.astro': '<div class="fake-site"><h1 class="fake-title">My site</h1><p>Lorem</p></div>',
      'src/components/PreviewModal.astro':
        "---\nimport PreviewSite from './PreviewSite.astro';\n---\n<dialog><PreviewSite /></dialog>",
      'src/layouts/Layout.astro': '<html lang="es"><slot /></html>',
      // Home: Hero + modal (no <h1> of its own)
      'src/pages/index.astro':
        "---\nimport Layout from '../layouts/Layout.astro';\nimport Hero from '../components/Hero.astro';\nimport PreviewModal from '../components/PreviewModal.astro';\n---\n<Layout><Hero /><PreviewModal /></Layout>",
      // Detail page: its own <h1> + the same modal
      'src/pages/[slug].astro':
        "---\nimport Layout from '../layouts/Layout.astro';\nimport PreviewModal from '../components/PreviewModal.astro';\n---\n<Layout><h1>Dots</h1><PreviewModal /></Layout>",
    });

    const h1Tasks = tasks.filter((t) => t.fingerprint.startsWith('markup:h1'));
    expect(h1Tasks).toHaveLength(1); // both pages, one task
    const [task] = h1Tasks;
    expect(task?.title).toBe('Fix duplicate `<h1>` caused by `PreviewSite.astro`');
    expect(task?.affectedFiles).toEqual(['src/components/PreviewSite.astro']);
    expect(task?.description).toContain('`src/components/Hero.astro`'); // named as the main title to keep
    expect(task?.suggestedImplementation).toContain('Keep the `<h1>` in `src/components/Hero.astro`');
  });

  it('asks the user to decide when it is not clear which <h1> is the main one', async () => {
    const tasks = await fixture({
      'src/components/Alpha.astro': '<h1>A</h1>',
      'src/components/Beta.astro': '<h1>B</h1>',
      'src/pages/index.astro':
        "---\nimport Alpha from '../components/Alpha.astro';\nimport Beta from '../components/Beta.astro';\n---\n<html lang=\"en\"><Alpha /><Beta /></html>",
    });

    const [task] = tasks.filter((t) => t.fingerprint.startsWith('markup:h1'));
    expect(task?.affectedFiles).toEqual(['src/components/Alpha.astro', 'src/components/Beta.astro']);
    expect(task?.suggestedImplementation).toContain('Decide which');
  });

  it('reports a page with two <h1> of its own', async () => {
    const tasks = await fixture({ 'src/pages/index.astro': '<html lang="en"><h1>A</h1><h1>B</h1></html>' });
    expect(tasks.map((t) => t.title)).toEqual(['Fix duplicate `<h1>` in `src/pages/index.astro`']);
  });

  it('checks plain HTML and JSX files one by one', async () => {
    const tasks = await fixture({
      'index.html': '<html lang="en"><h1>A</h1><h1>B</h1></html>',
      'src/App.tsx': 'export const App = () => <main><h1>One</h1></main>;',
    });
    expect(tasks.map((t) => t.fingerprint)).toEqual(['markup:h1:index.html']);
  });

  it('reports images without alt and <html> without lang', async () => {
    const tasks = await fixture({
      'src/layouts/Base.astro': '<html><body><img src="/logo.png"><img src="/bg.png"><slot /></body></html>',
    });

    expect(tasks.map((t) => t.title)).toEqual([
      'Add `alt` text to 2 images in `Base.astro`',
      'Add the `lang` attribute to `<html>` in `Base.astro`',
    ]);
  });

  it('finds nothing in clean markup', async () => {
    const tasks = await fixture({
      'src/layouts/Layout.astro': '<html lang="en"><header><p class="logo">Site</p></header><slot /></html>',
      'src/pages/index.astro': page(),
    });
    expect(tasks).toEqual([]);
  });
});
