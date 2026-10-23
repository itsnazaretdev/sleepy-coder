import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Runs the repository's own test script, and nothing else.
 *
 * - The command is read from the user's ORIGINAL checkout, never from what the agent wrote
 *   (and package.json is read-only for the agent anyway).
 * - It runs without a shell, with a timeout that stops the whole process tree,
 *   and with its output size-limited.
 */

export interface TestCommand {
  file: string;
  args: string[];
  /** Human-readable form, e.g. "pnpm test". */
  display: string;
}

export interface TestRunResult {
  command: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Last part of stdout + stderr. */
  output: string;
}

/** The script npm writes into new projects. It always fails, so it is not a real test script. */
const NPM_PLACEHOLDER = /no test specified/i;

/** Picks the package manager from the lockfile (pnpm, yarn, bun, npm). */
export function packageManagerFor(root: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/**
 * Finds how to run the tests of a JavaScript/TypeScript project.
 * Returns null when there is no usable "test" script (other ecosystems come later).
 */
export async function detectTestCommand(root: string): Promise<TestCommand | null> {
  let manifest: { scripts?: Record<string, unknown> };
  try {
    manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    return null;
  }

  const script = manifest.scripts?.test;
  if (typeof script !== 'string' || !script.trim() || NPM_PLACEHOLDER.test(script)) return null;

  const manager = packageManagerFor(root);
  // "bun test" would run Bun's own runner; "bun run test" runs the script.
  const args = manager === 'bun' ? ['run', 'test'] : ['test'];
  return { file: manager, args, display: `${manager} ${args.join(' ')}` };
}

const MAX_OUTPUT_CHARS = 20_000;

/** Sends a signal to the whole process group (npm → sh → node → test workers). */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

export async function runTests(
  cwd: string,
  command: TestCommand,
  options: { timeoutMs?: number } = {},
): Promise<TestRunResult> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const started = Date.now();

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;

    const finish = (passed: boolean, exitCode: number | null, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmed = output.trim();
      const tail = trimmed.length > MAX_OUTPUT_CHARS ? `…${trimmed.slice(-MAX_OUTPUT_CHARS)}` : trimmed;
      resolve({
        command: command.display,
        passed,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        output: extra ? `${tail}\n\n${extra}`.trim() : tail,
      });
    };

    // detached: the tests get their own process group, so a timeout can stop all of them,
    // not only the package manager (otherwise test workers would keep running).
    const child = spawn(command.file, command.args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // CI=1 makes runners like Vitest or Jest run once instead of staying in watch mode.
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const append = (chunk: string) => {
      output += chunk;
      if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS * 2);
    };
    child.stdout?.setEncoding('utf8').on('data', append);
    child.stderr?.setEncoding('utf8').on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT' ? `"${command.file}" is not installed or not in the PATH.` : error.message;
      finish(false, null, message);
    });

    child.on('close', (code) => {
      if (timedOut) finish(false, code, `Tests stopped after ${Math.round(timeoutMs / 1000)} s.`);
      else finish(code === 0, code);
    });
  });
}

/**
 * A fresh worktree has no node_modules. Instead of reinstalling (slow, needs network),
 * link the ones from the user's checkout: the root one and those of workspace packages
 * (e.g. apps/web/node_modules). Returns the linked paths.
 */
export async function linkDependencies(sourceRoot: string, targetRoot: string, maxDepth = 3): Promise<string[]> {
  const linked: string[] = [];

  async function visit(relative: string, depth: number): Promise<void> {
    const source = join(sourceRoot, relative);
    let entries;
    try {
      entries = await readdir(source, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git') continue;
      const childRelative = relative ? join(relative, entry.name) : entry.name;

      if (entry.name === 'node_modules') {
        const targetParent = join(targetRoot, relative);
        const target = join(targetRoot, childRelative);
        // Only where the worktree has the same folder and nothing is there yet.
        if (existsSync(targetParent) && !(await lstat(target).catch(() => null))) {
          await symlink(join(sourceRoot, childRelative), target, 'dir');
          linked.push(childRelative);
        }
        continue; // never look inside node_modules
      }

      if (depth < maxDepth && !entry.name.startsWith('.')) await visit(childRelative, depth + 1);
    }
  }

  await visit('', 0);
  return linked.sort();
}
