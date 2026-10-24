import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { ScannedFile } from '@sleepy-coder/analyzer';
import type { TaskDraft } from '@sleepy-coder/shared';

/**
 * SEO and accessibility checks on markup, without AI:
 * - more than one <h1> on a page (following Astro imports: layout + page),
 * - pages without <title> or without <meta name="description">,
 * - <img> without alt, links without text, target="_blank" without rel,
 * - <html> without lang.
 */

const MARKUP_EXTENSIONS = ['.astro', '.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte'];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_MARKUP_TASKS = 30;
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

/** `<a href="…" target="_blank">` without `rel="noopener"` (or `noreferrer`, which implies it). */
export function isUnsafeBlankTarget(tag: string): boolean {
  return /\btarget\s*=\s*["']_blank["']/i.test(tag) && !/\brel\s*=\s*["'][^"']*\b(noopener|noreferrer)\b/i.test(tag);
}

export const LINK_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

/**
 * A link with nothing a screen reader can read: no text, no aria-label/title,
 * no image with alt text. Dynamic content ({…}, <slot />) counts as text.
 */
export function isEmptyLink(attributes: string, inner: string): boolean {
  if (/\b(aria-label|aria-labelledby|title)\s*=/i.test(attributes)) return false;
  if (/[{]|<slot\b/i.test(inner)) return false;
  if (/<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(inner)) return false;
  if (/<title\b/i.test(inner)) return false; // inline SVG with a title
  return inner.replace(/<[^>]*>/g, '').trim() === '';
}

export function emptyLinks(template: string): number {
  return [...template.matchAll(LINK_PATTERN)].filter((m) => isEmptyLink(m[1] ?? '', m[2] ?? '')).length;
}

export function unsafeBlankTargets(template: string): number {
  return (template.match(/<a\b[^>]*>/gi) ?? []).filter(isUnsafeBlankTarget).length;
}

export const hasTitle = (template: string) => /<title[\s>]/i.test(template);
export const hasMetaDescription = (template: string) =>
  /<meta\b[^>]*\bname\s*=\s*["']description["']/i.test(template);

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

/** Every file a page renders: the page, then its components and layouts (recursively). */
export function renderedFiles(path: string, files: Map<string, MarkupFile>, depth = 0, seen = new Set<string>()): string[] {
  const file = files.get(path);
  if (!file || depth > MAX_DEPTH || seen.has(path)) return [];
  seen.add(path);
  const result = [path];
  for (const [name, target] of astroImports(file)) {
    if (usages(file.template, name) > 0) result.push(...renderedFiles(target, files, depth + 1, seen));
  }
  return result;
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

  // 2. Pages without <title> or meta description. The fix goes where the <head> is (usually the
  //    layout), so pages sharing a layout become one task.
  interface HeadGroup {
    pages: string[];
    title: boolean;
    description: boolean;
  }
  const byHead = new Map<string, HeadGroup>();
  const fullPages = [
    ...pages.map((page) => ({ page, chain: renderedFiles(page, files) })),
    ...[...files.keys()]
      .filter((p) => /\.html?$/i.test(p))
      .map((page) => ({ page, chain: [page] })),
  ];
  for (const { page, chain } of fullPages) {
    const templates = chain.map((p) => files.get(p)!.template);
    if (!templates.some((t) => /<html\b/i.test(t))) continue; // a partial, not a whole page
    const head = chain.find((p) => /<head[\s>]/i.test(files.get(p)!.template)) ?? page;
    const group = byHead.get(head) ?? { pages: [], title: true, description: true };
    group.pages.push(page);
    if (!templates.some(hasTitle)) group.title = false;
    if (!templates.some(hasMetaDescription)) group.description = false;
    byHead.set(head, group);
  }

  for (const [head, group] of byHead) {
    const where = `${code(head.split('/').pop()!)}`;
    const pagesText = group.pages.length === 1 ? code(group.pages[0]!) : `${group.pages.length} pages (${list(group.pages)})`;
    if (!group.title) {
      tasks.push({
        fingerprint: `markup:title:${head}`,
        source: 'static',
        title: `Add a ${code('<title>')} in ${where}`,
        description: `${pagesText} ${group.pages.length === 1 ? 'has' : 'have'} no ${code('<title>')}. Browsers show it in the tab and search engines use it as the result title.`,
        category: 'seo',
        priority: 'high',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [head],
        suggestedImplementation: `Inside ${code('<head>')} in ${code(head)}, add a ${code('<title>')} with a short, unique title. In a shared layout, take it from a prop (e.g. ${code('<title>{title}</title>')}) so each page sets its own.`,
      });
    }
    if (!group.description) {
      tasks.push({
        fingerprint: `markup:meta-description:${head}`,
        source: 'static',
        title: `Add a meta description in ${where}`,
        description: `${pagesText} ${group.pages.length === 1 ? 'has' : 'have'} no ${code('<meta name="description">')}. Search engines often show it under the title in results.`,
        category: 'seo',
        priority: 'medium',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [head],
        suggestedImplementation: `Inside ${code('<head>')} in ${code(head)}, add ${code('<meta name="description" content="…">')} with one or two sentences (about 150 characters). In a shared layout, take it from a prop so each page can have its own.`,
      });
    }
  }

  // 3. Images without alt, links without text, target="_blank" without rel, <html> without lang.
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

    const empty = emptyLinks(file.template);
    if (empty > 0) {
      tasks.push({
        fingerprint: `markup:empty-link:${path}`,
        source: 'static',
        title: `Give ${empty === 1 ? 'a link' : `${empty} links`} an accessible text in ${code(path.split('/').pop()!)}`,
        description: `${code(path)} has ${empty} ${code('<a>')} without text a screen reader can read (for example, a link that only contains an icon).`,
        category: 'seo',
        priority: 'medium',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [path],
        suggestedImplementation: `Add visible text, or an ${code('aria-label')} that says where the link goes (e.g. ${code('aria-label="GitHub profile"')}). For an icon image, give it a meaningful ${code('alt')}.`,
      });
    }

    const blank = unsafeBlankTargets(file.template);
    if (blank > 0) {
      tasks.push({
        fingerprint: `markup:blank-target:${path}`,
        source: 'static',
        title: `Add ${code('rel="noopener noreferrer"')} to ${blank === 1 ? 'a link' : `${blank} links`} with ${code('target="_blank"')} in ${code(path.split('/').pop()!)}`,
        description: `${code(path)} opens ${blank === 1 ? 'a link' : `${blank} links`} in a new tab without ${code('rel')}. Older browsers let the new page control yours through ${code('window.opener')}.`,
        category: 'seo',
        priority: 'low',
        complexity: 'small',
        risk: 'low',
        affectedFiles: [path],
        suggestedImplementation: `Add ${code('rel="noopener noreferrer"')} to each ${code('<a target="_blank">')}.`,
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
