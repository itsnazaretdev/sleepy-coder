import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentModel } from '@sleepy-coder/agent';
import type { ApiError, HuntResponse, Repository, Task, TaskRun } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { createSqliteRunStore } from '../src/store/runs.js';
import { clientHeaders } from './client-headers.js';
import { fakeGit } from './fake-git.js';
import { fakeOllama, model } from './fake-ollama.js';

let sandbox = '';
let repoDir = '';
let dataDir = '';
let app: FastifyInstance | undefined;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=Naza', '-c', 'user.email=naza@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

/** A fake agent model that creates a LICENSE file. */
const licenseModel: AgentModel = {
  async complete() {
    return JSON.stringify({ summary: 'Added the MIT license.', changes: [{ path: 'LICENSE', content: 'MIT License\n' }] });
  },
};

async function setup(agentModel: AgentModel = licenseModel) {
  app = await buildApp({
    git: fakeGit(),
    agentModel,
    ollama: fakeOllama({ models: [model('gemma3:4b')] }).client,
    config: { dataDir, experimentalAgent: true },
  });
  const repo = (await app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: { path: repoDir } })).json<Repository>();
  const hunt = (await app.inject({ method: 'POST', headers: clientHeaders, url: `/repositories/${repo.id}/tasks/hunt` })).json<HuntResponse>();
  const license = hunt.tasks.find((t) => t.title === 'Add a license') as Task;
  return { repo, license };
}

const approve = (id: string) =>
  app!.inject({ method: 'PATCH', headers: clientHeaders, url: `/tasks/${id}`, payload: { status: 'approved' } });
const runTask = (id: string) => app!.inject({ method: 'POST', headers: clientHeaders, url: `/tasks/${id}/run` });

/** Polls GET /runs/:id like the web app does, until the run ends. */
async function waitForRun(id: string): Promise<TaskRun> {
  for (let i = 0; i < 200; i++) {
    const run = (await app!.inject({ method: 'GET', url: `/runs/${id}` })).json<TaskRun>();
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Run did not finish in time');
}

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-runs-')));
  repoDir = join(sandbox, 'demo');
  dataDir = join(sandbox, 'data');
  await mkdir(join(repoDir, 'src'), { recursive: true });
  git(repoDir, 'init', '-b', 'main');
  await writeFile(join(repoDir, 'README.md'), '# demo\n');
  await writeFile(join(repoDir, 'src', 'index.js'), 'module.exports = 1;\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'Initial commit');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(sandbox, { recursive: true, force: true });
});

describe('POST /tasks/:id/run', () => {
  it('runs an approved task in the background and records the result', async () => {
    const { repo, license } = await setup();
    await approve(license.id);

    const started = await runTask(license.id);
    expect(started.statusCode).toBe(202);
    const run = started.json<TaskRun>();
    expect(run).toMatchObject({ taskId: license.id, repositoryId: repo.id, status: 'running' });

    const done = await waitForRun(run.id);
    expect(done.status).toBe('completed');
    expect(done.branch).toMatch(/^sleepy\/add-a-license-/);
    expect(done.files).toEqual([{ path: 'LICENSE', additions: 1, deletions: 0 }]);
    expect(done.summary).toBe('Added the MIT license.');
    expect(done.steps.map((s) => s.message)).toContain('Creating an isolated worktree');
    expect(done.finishedAt).not.toBeNull();

    // The branch exists in the user's repository; main is untouched.
    expect(git(repoDir, 'branch', '--list', done.branch!)).toContain(done.branch!);
    expect(git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    const latest = (await app!.inject({ method: 'GET', url: `/repositories/${repo.id}/runs` })).json<TaskRun[]>();
    expect(latest.map((r) => r.id)).toEqual([run.id]);
  });

  it('refuses tasks that are not approved', async () => {
    const { license } = await setup();
    const response = await runTask(license.id);

    expect(response.statusCode).toBe(409);
    expect(response.json<ApiError>().error).toBe('task-not-approved');
  });

  it('is turned off unless SLEEPY_EXPERIMENTAL_AGENT is set', async () => {
    const { license } = await setup();
    await approve(license.id);
    await app!.close();
    app = await buildApp({ git: fakeGit(), agentModel: licenseModel, config: { dataDir, experimentalAgent: false } });

    const response = await runTask(license.id);
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error).toBe('agent-disabled');
    expect((await app.inject({ method: 'GET', url: '/config' })).json()).toEqual({ experimentalAgent: false });
  });

  it('runs one task at a time', async () => {
    let release: () => void = () => {};
    const slowModel: AgentModel = {
      async complete() {
        await new Promise<void>((resolve) => (release = resolve));
        return JSON.stringify({ summary: 'x', changes: [{ path: 'LICENSE', content: 'MIT\n' }] });
      },
    };
    const { license } = await setup(slowModel);
    const readme = (await app!.inject({ method: 'GET', url: `/repositories/${license.repositoryId}/tasks` })).json<Task[]>();
    const other = readme.find((t) => t.id !== license.id)!;
    await approve(license.id);
    await approve(other.id);

    const first = (await runTask(license.id)).json<TaskRun>();
    // Wait until the agent is waiting for the model.
    for (let i = 0; i < 100 && !(await app!.inject({ method: 'GET', url: `/runs/${first.id}` })).json<TaskRun>().steps.some((s) => s.message.startsWith('Asking')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const second = await runTask(other.id);
    expect(second.statusCode).toBe(409);
    expect(second.json<ApiError>().error).toBe('agent-busy');

    release();
    expect((await waitForRun(first.id)).status).toBe('completed');
  });

  it('requires the client header', async () => {
    const { license } = await setup();
    await approve(license.id);
    const response = await app!.inject({ method: 'POST', url: `/tasks/${license.id}/run` });
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for unknown tasks and runs', async () => {
    await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await runTask(id)).json<ApiError>().error).toBe('task-not-found');
    expect((await app!.inject({ method: 'GET', url: `/runs/${id}` })).json<ApiError>().error).toBe('run-not-found');
  });
});

describe('interrupted runs', () => {
  it('marks runs left "running" by a previous backend as interrupted on startup', async () => {
    const { license } = await setup();
    await app!.close();

    // Simulate a backend that died in the middle of a run.
    const db = openDatabase(join(dataDir, 'sleepy-coder.db'));
    const stale = createSqliteRunStore(db).create(license.id, license.repositoryId);
    await mkdir(join(dataDir, 'worktrees', license.repositoryId, stale.id), { recursive: true });
    db.close();

    app = await buildApp({ git: fakeGit(), agentModel: licenseModel, config: { dataDir, experimentalAgent: true } });
    const run = (await app.inject({ method: 'GET', url: `/runs/${stale.id}` })).json<TaskRun>();

    expect(run.status).toBe('interrupted');
    expect(run.error).toContain('Nothing resumes automatically');
    expect(run.finishedAt).not.toBeNull();
  });
});
