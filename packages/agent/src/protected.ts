/**
 * Files the agent may read but never write.
 *
 * The agent's changes are later executed when the tests run. These files decide WHAT gets
 * executed (scripts, configs, dependencies, CI, hooks) or hold secrets, so letting the model
 * change them would let it decide which commands run on the user's machine.
 */

/** Folders the agent can neither read nor write. */
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);

/** Exact file names that are protected wherever they are. */
const PROTECTED_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.gitmodules',
  '.gitattributes',
]);

/** Folders whose content is protected (CI pipelines, git hooks). */
const PROTECTED_DIRS = new Set(['.github', '.husky', '.githooks', '.vscode']);

/**
 * Config files that tools execute as code: vitest.config.ts, astro.config.mjs, eslint.config.js,
 * .eslintrc.cjs… (a plain "config.ts" of the app itself is NOT matched).
 */
const EXECUTED_CONFIG = /\.config\.[cm]?[jt]s$|^vitest\.workspace\.[cm]?[jt]s$|^\.[a-z]+rc\.[cm]?js$/;

export function isHiddenPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => HIDDEN_DIRS.has(segment));
}

/** Returns why the path is protected, or null if the agent may write it. */
export function protectedReason(relativePath: string): string | null {
  const segments = relativePath.split('/');
  const name = segments[segments.length - 1] ?? '';

  if (isHiddenPath(relativePath)) return 'Git internals and dependencies are off limits.';
  if (PROTECTED_NAMES.has(name)) return 'Dependency and package-manager files decide what runs; they are read-only.';
  if (name.startsWith('.env')) return 'Environment files may contain secrets; they are read-only.';
  if (segments.slice(0, -1).some((s) => PROTECTED_DIRS.has(s))) return 'CI, hooks and editor settings are read-only.';
  if (EXECUTED_CONFIG.test(name)) return 'Tool configuration files are executed by tools; they are read-only.';
  return null;
}
