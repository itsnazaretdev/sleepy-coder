import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTask, type AgentMessage, type AgentModel, type AgentTask } from '../src/index.js';

/**
 * End-to-end tests of the agent with a real Git repository, a real `npm test`
 * and a scripted fake model. They run for a few seconds each.
 */

let sandbox = '';
let repo = '';
let worktreesDir = '';

const GOOD_MATH = 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n';
const DOCUMENTED_MATH = '/** Adds two numbers. */\n' + GOOD_MATH;
const BROKEN_MATH = 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n';
const TEST_JS =
  "const { add } = require('./math.js');\nif (add(2, 3) !== 5) {\n  console.error('add(2, 3) should be 5');\n  process.exit(1);\n}\nconsole.log('all tests passed');\n";

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Naza', '-c', 'user.email=naza@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

async function createRepo(files: Record<string, string>) {
  await mkdir(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  for (const [path, content] of Object.entries(files)) await writeFile(join(repo, path), content);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial commit');
}

const task: AgentTask = {
  id: '1a2b3c4d-0000-4000-8000-000000000000',
  title: 'Document the `add` function',
  description: '`add` has no documentation.',
  suggestedImplementation: 'Add a JSDoc comment.',
  affectedFiles: ['math.js'],
  category: 'documentation',
};

/** Fake model: answers with the scripted replies in order, and records what it was asked. */
function scriptedModel(...replies: Array<unknown | Error>) {
  const calls: AgentMessage[][] = [];
  const model: AgentModel = {
    async complete(messages) {
      calls.push(messages);
      const reply = replies[calls.length - 1];
      if (reply instanceof Error) throw reply;
      if (reply === undefined) throw new Error('No more scripted replies');
      return typeof reply === 'string' ? reply : JSON.stringify(reply);
    },
  };
  return { model, calls };
}

const edit = (summary: string, path: string, content: string) => ({ summary, changes: [{ path, content }] });

const run = (model: AgentModel, overrides: Partial<AgentTask> = {}) => {
  const steps: string[] = [];
  return executeTask({
    task: { ...task, ...overrides },
    repoPath: repo,
    worktreePath: join(worktreesDir, 'run-1'),
    model,
    testingTools: [],
    onStep: (message) => steps.push(message),
    testTimeoutMs: 60_000,
  }).then((outcome) => ({ outcome, steps }));
};

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-agent-')));
  repo = join(sandbox, 'repo');
  worktreesDir = join(sandbox, 'data', 'worktrees');
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const withTests = { 'package.json': JSON.stringify({ scripts: { test: 'node test.js' } }), 'math.js': GOOD_MATH, 'test.js': TEST_JS };

describe('executeTask', () => {
  it('completes a task: commits on its own branch, tests pass, the user checkout is untouched', async () => {
    await createRepo(withTests);
    const { model, calls } = scriptedModel(edit('Added a JSDoc comment to add.', 'math.js', DOCUMENTED_MATH));

    const { outcome, steps } = await run(model);

    expect(outcome.status).toBe('completed');
    expect(outcome.branch).toBe('sleepy/document-the-add-function-1a2b3c4d');
    expect(outcome.testsBefore?.passed).toBe(true);
    expect(outcome.testsAfter?.passed).toBe(true);
    expect(outcome.files).toEqual([{ path: 'math.js', additions: 1, deletions: 0 }]);
    expect(outcome.diff).toContain('+/** Adds two numbers. */');
    expect(outcome.summary).toBe('Added a JSDoc comment to add.');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.content).toContain('### math.js'); // the model saw the file

    // The commit lives on the agent branch; main and the user's files did not change.
    expect(git(repo, 'log', '-1', '--format=%an', outcome.branch!)).toBe('Sleepy Coder');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(await readFile(join(repo, 'math.js'), 'utf8')).toBe(GOOD_MATH);
    // The worktree folder was cleaned up.
    expect(existsSync(join(worktreesDir, 'run-1'))).toBe(false);
    expect(steps[0]).toBe('Creating an isolated worktree');
  });

  it('gives the model one chance to fix a change that breaks the tests', async () => {
    await createRepo(withTests);
    const { model, calls } = scriptedModel(
      edit('Rewrote add.', 'math.js', BROKEN_MATH),
      edit('Fixed add.', 'math.js', DOCUMENTED_MATH),
    );

    const { outcome } = await run(model);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]?.content).toContain('add(2, 3) should be 5'); // it saw the failing output
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toBe('Fixed add.');
  });

  it('keeps the branch but reports tests-failed when the fix does not work', async () => {
    await createRepo(withTests);
    const { model } = scriptedModel(edit('a', 'math.js', BROKEN_MATH), edit('b', 'math.js', BROKEN_MATH.replace('-', '*')));

    const { outcome } = await run(model);

    expect(outcome.status).toBe('tests-failed');
    expect(outcome.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.testsAfter?.passed).toBe(false);
    expect(outcome.error).toContain('tests fail');
    expect(git(repo, 'branch', '--list', outcome.branch!)).toContain(outcome.branch!);
  });

  it('does not retry when the tests were already failing before', async () => {
    await createRepo({ ...withTests, 'math.js': BROKEN_MATH });
    const { model, calls } = scriptedModel(edit('Documented.', 'math.js', '/** Subtracts?! */\n' + BROKEN_MATH));

    const { outcome } = await run(model);

    expect(calls).toHaveLength(1);
    expect(outcome.testsBefore?.passed).toBe(false);
    expect(outcome.status).toBe('tests-failed');
    expect(outcome.error).toContain('already failing');
  });

  it('fails without committing when the model writes a placeholder, and deletes the empty branch', async () => {
    await createRepo({ ...withTests, 'math.js': GOOD_MATH.repeat(6) });
    const { model } = scriptedModel(edit('Done', 'math.js', '/** Docs */\n// ... rest of the code\n'));

    const { outcome } = await run(model);

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('placeholder');
    expect(outcome.commit).toBeNull();
    expect(outcome.branch).toBeNull();
    expect(git(repo, 'branch', '--list', 'sleepy/*')).toBe('');
    expect(await readdir(worktreesDir)).toEqual([]);
  });

  it('refuses to let the model change package.json', async () => {
    await createRepo(withTests);
    const { model } = scriptedModel(edit('Changed tests', 'package.json', '{"scripts":{"test":"echo hacked"}}'));

    const { outcome } = await run(model);

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('package.json');
    expect(outcome.error).toContain('protected');
  });

  it('completes without tests when the repository has no test script', async () => {
    await createRepo({ 'math.js': GOOD_MATH });
    const { model } = scriptedModel(edit('Documented add.', 'math.js', DOCUMENTED_MATH));

    const { outcome, steps } = await run(model);

    expect(outcome.status).toBe('completed');
    expect(outcome.testsBefore).toBeNull();
    expect(outcome.testsAfter).toBeNull();
    expect(steps).toContain('No test script found: changes will not be tested');
  });

  it('creates new files, e.g. a LICENSE', async () => {
    await createRepo({ 'math.js': GOOD_MATH });
    const { model } = scriptedModel(edit('Added the MIT license.', 'LICENSE', 'MIT License\n\nCopyright (c) 2026 Naza\n'));

    const { outcome } = await run(model, { title: 'Add a license', affectedFiles: ['LICENSE'], category: 'documentation' });

    expect(outcome.status).toBe('completed');
    expect(outcome.files).toEqual([{ path: 'LICENSE', additions: 3, deletions: 0 }]);
  });

  it('does not report "Done" when the model only reformats the file (instead of doing the task)', async () => {
    const gallery = 'const options = {\n  threshold: 0.25\n};\n\nconst cards = [];\n\n<img src="/bg.png">\n';
    await createRepo({ 'Gallery.astro': gallery });
    const { model } = scriptedModel(
      edit('Added alt text.', 'Gallery.astro', 'const options = { threshold: 0.25 };\nconst cards = [];\n<img src="/bg.png">\n'),
    );

    const { outcome } = await run(model, { title: 'Add alt text to the gallery images', affectedFiles: ['Gallery.astro'] });

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('only changes formatting');
    expect(outcome.commit).toBeNull();
    expect(git(repo, 'branch', '--list', 'sleepy/*')).toBe('');
  });

  it('changes one line of a long file with a search/replace block (the PreviewSite case)', async () => {
    const styles = Array.from({ length: 60 }, (_, i) => `  .fake-site .block-${i} { padding: ${i}px; }`).join('\n');
    const preview = `<div class="fake-site">\n  <h1 class="fake-title">My site</h1>\n  <p>Lorem ipsum</p>\n</div>\n\n<style>\n${styles}\n</style>\n`;
    await createRepo({ 'PreviewSite.astro': preview });
    const { model } = scriptedModel({
      summary: 'Changed the fake title to a `<p>`.',
      changes: [{ path: 'PreviewSite.astro', search: '<h1 class="fake-title">My site</h1>', replace: '<p class="fake-title">My site</p>' }],
    });

    const { outcome } = await run(model, { title: 'Fix duplicate h1', affectedFiles: ['PreviewSite.astro'] });

    expect(outcome.status).toBe('completed');
    expect(outcome.files).toEqual([{ path: 'PreviewSite.astro', additions: 1, deletions: 1 }]);
    expect(git(repo, 'show', `${outcome.branch}:PreviewSite.astro`)).toBe(
      preview.replace('<h1 class="fake-title">My site</h1>', '<p class="fake-title">My site</p>').trimEnd(),
    );
  });

  it('includes the model’s explanation when it returns no change', async () => {
    await createRepo({ 'math.js': GOOD_MATH });
    const { model } = scriptedModel({ summary: 'There are no images in math.js.', changes: [] });

    const { outcome } = await run(model);

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('The model said: "There are no images in math.js."');
  });

  it('checks that the task is solved and gives the model one chance to finish it', async () => {
    await createRepo({ 'page.html': '<img src="a.png">\n<img src="b.png">\n' });
    const { model, calls } = scriptedModel(
      edit('Added alt to the first image.', 'page.html', '<img src="a.png" alt="A">\n<img src="b.png">\n'),
      edit('Added alt to both images.', 'page.html', '<img src="a.png" alt="A">\n<img src="b.png" alt="B">\n'),
    );
    // Like the server does: the task is solved when no <img> is left without alt.
    const verify = async (path: string) => {
      const html = await readFile(join(path, 'page.html'), 'utf8');
      const missing = (html.match(/<img(?![^>]*alt=)[^>]*>/g) ?? []).length;
      return missing > 0 ? `${missing} image(s) still have no alt` : null;
    };

    const steps: string[] = [];
    const outcome = await executeTask({
      task: { ...task, title: 'Add alt text', affectedFiles: ['page.html'] },
      repoPath: repo,
      worktreePath: join(worktreesDir, 'run-1'),
      model,
      verify,
      onStep: (message) => steps.push(message),
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]?.content).toContain('1 image(s) still have no alt');
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toBe('Added alt to both images.');
    expect(outcome.diff).toContain('alt="B"');
    expect(steps).toContain('The problem is still there: asking the model to fix its change');
  });

  it('fails without committing when the check still finds the problem after the second try', async () => {
    await createRepo({ 'page.html': '<img src="a.png">\n' });
    const { model } = scriptedModel(
      edit('Tried.', 'page.html', '<img src="a.png">\n<p>Gallery</p>\n'),
      edit('Tried again.', 'page.html', '<img src="a.png">\n<p>Our gallery</p>\n'),
    );

    const outcome = await executeTask({
      task: { ...task, title: 'Add alt text', affectedFiles: ['page.html'] },
      repoPath: repo,
      worktreePath: join(worktreesDir, 'run-1'),
      model,
      verify: async () => 'the image in page.html has no alt',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('did not solve the task');
    expect(outcome.error).toContain('the image in page.html has no alt');
    expect(outcome.commit).toBeNull();
    expect(git(repo, 'branch', '--list', 'sleepy/*')).toBe('');
  });

  it('fails cleanly when the model is not reachable', async () => {
    await createRepo(withTests);
    const { model } = scriptedModel(new Error('Could not connect to Ollama'));

    const { outcome } = await run(model);

    expect(outcome).toMatchObject({ status: 'failed', commit: null, branch: null });
    expect(outcome.error).toContain('Could not connect to Ollama');
    expect(await readdir(worktreesDir)).toEqual([]);
  });

  it('fails when the repository has no commits', async () => {
    await mkdir(repo, { recursive: true });
    git(repo, 'init', '-b', 'main');
    const { model, calls } = scriptedModel();

    const { outcome } = await run(model);

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('no commits');
    expect(calls).toHaveLength(0);
  });
});
