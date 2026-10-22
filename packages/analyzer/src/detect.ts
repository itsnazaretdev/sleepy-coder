import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScannedFile } from './scan.js';

/** Files bigger than this are not read for detection. */
const MAX_READ_BYTES = 512 * 1024;
/** Upper bound on manifests / source files read, to keep analysis fast. */
const MAX_MANIFESTS = 30;
const MAX_SOURCE_SAMPLES = 200;

export interface StackDetection {
  packageManagers: string[];
  frameworks: string[];
  testingTools: string[];
  configFiles: string[];
  testFiles: number;
  hasReadme: boolean;
  hasLicense: boolean;
}

// --- Lookup tables ----------------------------------------------------------

const PACKAGE_MANAGER_BY_FILE: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
  'yarn.lock': 'Yarn',
  'bun.lockb': 'Bun',
  'bun.lock': 'Bun',
  'composer.json': 'Composer',
  'pom.xml': 'Maven',
  'build.gradle': 'Gradle',
  'build.gradle.kts': 'Gradle',
  'requirements.txt': 'pip',
  'poetry.lock': 'Poetry',
  Pipfile: 'Pipenv',
  'Cargo.toml': 'Cargo',
  'go.mod': 'Go modules',
  Gemfile: 'Bundler',
};

/** npm dependency → framework name. */
const NPM_FRAMEWORKS: Record<string, string> = {
  astro: 'Astro',
  react: 'React',
  next: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  '@angular/core': 'Angular',
  'solid-js': 'Solid',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  hono: 'Hono',
  koa: 'Koa',
  vite: 'Vite',
  tailwindcss: 'Tailwind CSS',
  bootstrap: 'Bootstrap',
  electron: 'Electron',
  'react-native': 'React Native',
};

/** npm dependency → testing tool name. */
const NPM_TEST_TOOLS: Record<string, string> = {
  vitest: 'Vitest',
  jest: 'Jest',
  mocha: 'Mocha',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  '@testing-library/react': 'Testing Library',
  '@testing-library/dom': 'Testing Library',
  '@testing-library/vue': 'Testing Library',
};

const COMPOSER_FRAMEWORKS: Record<string, string> = {
  'laravel/framework': 'Laravel',
  'symfony/framework-bundle': 'Symfony',
};

/** Basename pattern → config tool name. */
const CONFIG_PATTERNS: Array<[RegExp, string]> = [
  [/^tsconfig(\..+)?\.json$/, 'TypeScript'],
  [/^(\.eslintrc(\..+)?|eslint\.config\.[cm]?[jt]s)$/, 'ESLint'],
  [/^(\.prettierrc(\..+)?|prettier\.config\.[cm]?[jt]s)$/, 'Prettier'],
  [/^\.editorconfig$/, 'EditorConfig'],
  [/^Dockerfile(\..+)?$/, 'Docker'],
  [/^(docker-)?compose\.ya?ml$/, 'Docker Compose'],
  [/^\.gitignore$/, '.gitignore'],
  [/^\.env\.example$/, '.env.example'],
];

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/, // foo.test.ts, foo.spec.jsx
  /(^|\/)(__tests__|tests?)\/.+\.[cm]?[jt]sx?$/, // files inside test/ or __tests__/
  /Tests?\.(java|kt|php)$/, // FooTest.java
  /_test\.(go|py)$/, // foo_test.go
  /(^|\/)test_[^/]+\.py$/, // test_foo.py
];

// --- Helpers ----------------------------------------------------------------

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const isRootLevel = (path: string) => !path.includes('/');

async function readText(root: string, file: ScannedFile): Promise<string | null> {
  if (file.size > MAX_READ_BYTES) return null;
  try {
    return await readFile(join(root, file.path), 'utf8');
  } catch {
    return null;
  }
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dependencyNames(manifest: Record<string, unknown>, fields: string[]): string[] {
  return fields.flatMap((field) => {
    const deps = manifest[field];
    return deps && typeof deps === 'object' ? Object.keys(deps) : [];
  });
}

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

// --- Main -------------------------------------------------------------------

/** Detects package managers, frameworks, testing tools and config from the scanned files. */
export async function detectStack(root: string, files: ScannedFile[]): Promise<StackDetection> {
  const packageManagers = new Set<string>();
  const frameworks = new Set<string>();
  const testingTools = new Set<string>();
  const configFiles = new Set<string>();

  const manifests: ScannedFile[] = [];
  const javaSources: ScannedFile[] = [];
  let testFiles = 0;

  for (const file of files) {
    const name = basename(file.path);

    const manager = PACKAGE_MANAGER_BY_FILE[name];
    if (manager) packageManagers.add(manager);

    for (const [pattern, tool] of CONFIG_PATTERNS) {
      if (pattern.test(name)) configFiles.add(tool);
    }
    if (file.path.startsWith('.github/workflows/')) configFiles.add('GitHub Actions');

    if (isTestFile(file.path)) testFiles += 1;

    if (
      ['package.json', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt'].includes(
        name,
      ) &&
      manifests.length < MAX_MANIFESTS
    ) {
      manifests.push(file);
    }

    if (name.endsWith('.java') && javaSources.length < MAX_SOURCE_SAMPLES) javaSources.push(file);
  }

  for (const file of manifests) {
    const name = basename(file.path);
    const text = await readText(root, file);
    if (!text) continue;

    if (name === 'package.json') {
      const manifest = parseJson(text);
      if (!manifest) continue;
      for (const dep of dependencyNames(manifest, ['dependencies', 'devDependencies', 'peerDependencies'])) {
        const framework = NPM_FRAMEWORKS[dep];
        if (framework) frameworks.add(framework);
        const tool = NPM_TEST_TOOLS[dep];
        if (tool) testingTools.add(tool);
      }
    } else if (name === 'composer.json') {
      const manifest = parseJson(text);
      if (!manifest) continue;
      for (const dep of dependencyNames(manifest, ['require', 'require-dev'])) {
        const framework = COMPOSER_FRAMEWORKS[dep];
        if (framework) frameworks.add(framework);
        if (dep === 'phpunit/phpunit') testingTools.add('PHPUnit');
      }
    } else if (name === 'requirements.txt') {
      const lower = text.toLowerCase();
      if (/^django\b/m.test(lower)) frameworks.add('Django');
      if (/^flask\b/m.test(lower)) frameworks.add('Flask');
      if (/^fastapi\b/m.test(lower)) frameworks.add('FastAPI');
      if (/^pytest\b/m.test(lower)) testingTools.add('pytest');
    } else {
      // pom.xml / build.gradle: plain text search is enough here.
      if (text.includes('spring-boot')) frameworks.add('Spring Boot');
      if (text.includes('javafx')) frameworks.add('JavaFX');
      if (/junit/i.test(text)) testingTools.add('JUnit');
    }
  }

  for (const file of javaSources) {
    if (frameworks.has('Swing')) break;
    const text = await readText(root, file);
    if (text && /^\s*import\s+javax\.swing\b/m.test(text)) frameworks.add('Swing');
  }

  return {
    packageManagers: sorted(packageManagers),
    frameworks: sorted(frameworks),
    testingTools: sorted(testingTools),
    configFiles: sorted(configFiles),
    testFiles,
    hasReadme: files.some((f) => isRootLevel(f.path) && /^readme(\.|$)/i.test(f.path)),
    hasLicense: files.some((f) => isRootLevel(f.path) && /^(license|licence|copying)(\.|$)/i.test(f.path)),
  };
}
