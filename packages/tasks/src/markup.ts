import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { ScannedFile } from '@sleepy-coder/analyzer';
import type { TaskDraft } from '@sleepy-coder/shared';

/**
 * SEO and accessibility checks on markup, without AI:
 * - more than one <h1> on a page (following Astro imports: layout + page),
 * - <img> without alt,
 * - <html> without lang.
 */

const MARKUP_EXTENSIONS = ['.astro', '.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte'];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_MARKUP_TASKS = 20;
const MAX_DEPTH = 4;

export interface MarkupFile {
  path: string;
  /** Template without comments (and without the Astro frontmatter). */
  template: string;
  /** Astro frontmatter (where components are imported). Empty for other files. */
  frontmatter: string;
}

const isMarkup = (path: string) => MARKUP_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));

/** Splits an Astro file into frontmatter and template, and removes comments from the template. */
export function parseMarkup(path: string, content: string): MarkupFile {
  let frontmatter = '';
  let template = content;

  if (path.endsWith('.astro')) {
    const match = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (match) {
      frontmatter = match[1] ?? '';
      template = content.slice(match[0].length);
    }
  }

  template = template
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ''); // JSX / Astro comments
  return { path, template, frontmatter };
}

/** Number of <h1> elements written directly in the template. */
export function countH1(template: string): number {
  return (template.match(/<h1(?=[\s>])/gi) ?? []).length;
}

/** <img> tags without an alt attribute (tags with a spread like {...props} are skipped: alt may be inside). */
export function imagesWithoutAlt(template: string): number {
  const tags = template.match(/<img\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => !/\balt\s*=/i.test(tag) && !/\{\s*\.\.\./.test(tag)).length;
}

export function htmlWithoutLang(template: string): boolean {
  const tag = /<html\b[^>]*>/i.exec(template)?.[0];
  return tag !== undefined && !/\blang\s*=/i.test(tag);
}

/**
 * `import Layout from '../layouts/Layout.astro'` → { Layout: 'src/layouts/Layout.astro' }.
 * Also understands the common aliases `@/…` and `~/…` (pointing to `src/`).
 */
export function astroImports(file: MarkupFile): Map<string, string> {
  const imports = new Map<string, string>();
  const pattern = /import\s+([A-Z][\w$]*)\s+from\s+['"]([^'"]+\.astro)['"]/g;
  for (const match of file.frontmatter.matchAll(pattern)) {
    const [, name, source] = match;
    if (!name || !source) continue;

    let target: string | null = null;
    if (source.startsWith('.')) target = join(dirname(file.path), source);
    else if (source.startsWith('@/') || source.startsWith('~/')) target = join('src', source.slice(2));
    if (target) imports.set(name, normalize(target).replace(/\\/g, '/'));
  }
  return imports;
}

/** How many times a component is used in a template: <Layout …> or <Layout/>. */
function usages(template: string, name: string): number {
  return (template.match(new RegExp(`<${name}(?=[\\s/>])`, 'g')) ?? []).length;
}

interface H1Count {
  total: number;
  /** Files that contain at least one of those <h1>. */
  sources: string[];
}

/** Counts the <h1> a page renders, including those in the Astro components it uses (recursively). */
export function renderedH1(path: string, files: Map<string, MarkupFile>, depth = 0, visiting = new Set<string>()): H1Count {
  const file = files.get(path);
  if (!file || depth > MAX_DEPTH || visiting.has(path)) return { total: 0, sources: [] };
  visiting.add(path);

  const own = countH1(file.template);
  let total = own;
  const sources = new Set<string>(own > 0 ? [path] : []);

  for (const [name, target] of astroImports(file)) {
    const used = usages(file.template, name);
    if (used === 0) continue;
    const child = renderedH1(target, files, depth + 1, visiting);
    total += used * child.total;
    child.sources.forEach((s) => sources.add(s));
  }

  visiting.delete(path);
  return { total, sources: [...sources].sort() };
}

const code = (text: string) => `\`${text}\``;
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Components that usually hold the page's real title. */
const MAIN_TITLE_NAME = /(hero|header|masthead|banner|intro|jumbotron)/i;
/** Components that usually hold extra or fake headings: previews, modals, cards, mockups… */
const SECONDARY_NAME = /(modal|dialog|popup|preview|mock|demo|example|sample|card|simulat|frame)/i;

/**
 * Which file holds the page's real <h1> (the one to keep)?
 * 1. the page itself, if it has one;
 * 2. otherwise a hero/header-like component;
 * 3. otherwise the only file that does not look like a preview/modal/card.
 * Returns null when it is not clear: then the task asks the user to decide.
 */
export function mainH1Source(page: string, sources: string[]): string | null {
  if (sources.includes(page)) return page;

  const titleLike = sources.filter((s) => MAIN_TITLE_NAME.test(baseName(s)) && !SECONDARY_NAME.test(baseName(s)));
  if (titleLike.length === 1) return titleLike[0]!;

  const notSecondary = sources.filter((s) => !SECONDARY_NAME.test(baseName(s)));
  if (notSecondary.length === 1) return notSecondary[0]!;

  return null;
}

function list(paths: string[], max = 3): string {
  const shown = paths.slice(0, max).map(code).join(', ');
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

/** Runs every markup check and turns the findings into tasks. Read-only. */
export async function findMarkupIssues(root: string, scanned: ScannedFile[]): Promise<TaskDraft[]> {
  const files = new Map<string, MarkupFile>();
  for (const file of scanned) {
    if (!isMarkup(file.path) || file.size > MAX_FILE_BYTES) continue;
    try {
      files.set(file.path, parseMarkup(file.path, await readFile(join(root, file.path), 'utf8')));
    } catch {
      // Unreadable file: skip.
    }
  }

  const tasks: TaskDraft[] = [];

  // 1. Duplicate <h1>. Astro pages are checked as rendered (page + layout + components);
  //    other files are checked one by one.
  const pages = [...files.keys()].filter((p) => /(^|\/)src\/pages\/.+\.astro$/.test(p));
  const astroInPages = new Set(pages);

  interface H1Group {
    pages: string[];
    /** Files whose <h1> is the real main title (kept). */
    mains: Set<string>;
    /** Files whose <h1> is extra (to change). */
    culprits: string[];
    total: number;
  }
  const byCulprit = new Map<string, H1Group>();

  for (const page of pages) {
    const { total, sources } = renderedH1(page, files);
    if (total < 2) continue;

    const main = mainH1Source(page, sources);
    // Without a clear main title, every file with an <h1> is involved.
    const culprits = main ? sources.filter((s) => s !== main) : sources;
    // Pages broken by the same extra <h1> (e.g. a shared modal) become ONE task.
    const key = culprits.length > 0 ? culprits.join('|') : page;

    const group = byCulprit.get(key) ?? { pages: [], mains: new Set<string>(), culprits, total };
    group.pages.push(page);
    if (main) group.mains.add(main);
    byCulprit.set(key, group);
  }

  for (const [key, group] of byCulprit) {
    // No other file involved: the page itself has more than one <h1>.
    const ownDuplicates = group.culprits.length === 0;
    const mains = [...group.mains].sort();
    const names = group.culprits.map(baseName);
    const pagesText = `${list(group.pages)} render${group.pages.length === 1 ? 's' : ''} more than one ${code('<h1>')}.`;

    if (ownDuplicates) {
      tasks.push({
        fingerprint: `markup:h1:${key}`,
        source: 'static',
        title: `Fix duplicate ${code('<h1>')} in ${code(group.pages[0]!)}`,
        description: `${code(group.pages[0]!)} renders ${group.total} ${code('<h1>')} headings. A page should have exactly one.`,
        category: 'seo',
        priority: 'high',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [group.pages[0]!],
        suggestedImplementation: `Keep one ${code('<h1>')} for the main title and change the others to ${code('<h2>')}.`,
      });
      continue;
    }

    tasks.push({
      fingerprint: `markup:h1:${key}`,
      source: 'static',
      title: `Fix duplicate ${code('<h1>')} caused by ${names.map(code).join(', ')}`,
      description:
        mains.length > 0
          ? `${pagesText} The main title is the ${code('<h1>')} in ${list(mains)}; the extra one comes from ` +
            `${list(group.culprits)}. A page should have exactly one ${code('<h1>')}: search engines and screen ` +
            `readers use it as the main title.`
          : `${pagesText} It comes from ${list(group.culprits)}. A page should have exactly one ${code('<h1>')}.`,
      category: 'seo',
      priority: 'high',
      complexity: 'small',
      risk: 'low',
      // Only the files to change: the main title must stay untouched.
      affectedFiles: group.culprits.slice(0, 5),
      suggestedImplementation:
        mains.length > 0
          ? `Keep the ${code('<h1>')} in ${list(mains)}: it is the main title, do not change it. ` +
            `In ${list(group.culprits)}, change ${code('<h1>')} to ${code('<p>')} or ${code('<span>')} with the same ` +
            `class (or to ${code('<h2>')} if it really is a section title), so it looks the same but is no longer ` +
            `the main heading of the page.`
          : `Decide which ${code('<h1>')} is the main title of the page and keep only that one. Change the others to ` +
            `${code('<h2>')}, or to ${code('<p>')} / ${code('<span>')} with the same class so the look does not change.`,
    });
  }

  for (const [path, file] of files) {
    if (astroInPages.has(path) || path.endsWith('.astro')) continue; // Astro handled above
    const count = countH1(file.template);
    if (count < 2) continue;
    tasks.push({
      fingerprint: `markup:h1:${path}`,
      source: 'static',
      title: `Fix duplicate ${code('<h1>')} in ${code(path)}`,
      description: `${code(path)} has ${count} ${code('<h1>')} headings. A page should have exactly one.`,
      category: 'seo',
      priority: 'high',
      complexity: 'small',
      risk: 'low',
      affectedFiles: [path],
      suggestedImplementation: `Keep one ${code('<h1>')} for the main title and change the others to ${code('<h2>')}.`,
    });
  }

  // 2. Images without alt, and 3. <html> without lang.
  for (const [path, file] of files) {
    const missingAlt = imagesWithoutAlt(file.template);
    if (missingAlt > 0) {
      tasks.push({
        fingerprint: `markup:img-alt:${path}`,
        source: 'static',
        title: `Add ${code('alt')} text to ${missingAlt === 1 ? 'an image' : `${missingAlt} images`} in ${code(path.split('/').pop()!)}`,
        description: `${code(path)} has ${missingAlt} ${code('<img>')} without an ${code('alt')} attribute. Screen readers cannot describe them and search engines ignore them.`,
        category: 'seo',
        priority: 'medium',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [path],
        suggestedImplementation: `Add a short ${code('alt')} that describes each image. For purely decorative images, use ${code('alt=""')}.`,
      });
    }

    if (htmlWithoutLang(file.template)) {
      tasks.push({
        fingerprint: `markup:html-lang:${path}`,
        source: 'static',
        title: `Add the ${code('lang')} attribute to ${code('<html>')} in ${code(path.split('/').pop()!)}`,
        description: `The ${code('<html>')} tag in ${code(path)} has no ${code('lang')}. Browsers, screen readers and search engines use it to know the language of the page.`,
        category: 'seo',
        priority: 'medium',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [path],
        suggestedImplementation: `Add the page language, e.g. ${code('<html lang="en">')} or ${code('<html lang="es">')}.`,
      });
    }
  }

  return tasks.slice(0, MAX_MARKUP_TASKS);
}
