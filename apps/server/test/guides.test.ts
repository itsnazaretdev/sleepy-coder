import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TaskModel } from '@sleepy-coder/tasks';
import type { ApiError, CheckTaskResponse, HuntResponse, Repository, Task, TaskGuideResponse } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { clientHeaders } from './client-headers.js';
import { fakeGit } from './fake-git.js';
import { memoryDb } from './memory-db.js';

let sandbox = '';
let repoDir = '';
let app: FastifyInstance;
let fixme: Task;

const guideModel: TaskModel = {
  async complete() {
    return JSON.stringify({
      explanation: 'Errors are not handled.',
      steps: ['In `src/index.ts` line 1, wrap the call in `try`/`catch`.'],
      suggestions: [{ path: 'src/index.ts', code: 'try { run(); } catch (error) { console.error(error); }' }],
    });
  },
};

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-guides-api-')));
  repoDir = join(sandbox, 'demo');
  await mkdir(join(repoDir, '.git'), { recursive: true });
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'README.md'), '# demo');
  await writeFile(join(repoDir, 'src', 'index.ts'), '// FIXME: handle errors\nexport const a = 1;\n');

  app = await buildApp({ database: memoryDb(), git: fakeGit(), guideModel });
  const repo = (await app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: { path: repoDir } })).json<Repository>();
  const hunt = (await app.inject({ method: 'POST', headers: clientHeaders, url: `/repositories/${repo.id}/tasks/hunt` })).json<HuntResponse>();
  fixme = hunt.tasks.find((t) => t.category === 'todo')!;
});

afterEach(async () => {
  await app.close();
  await rm(sandbox, { recursive: true, force: true });
});

const post = (url: string) => app.inject({ method: 'POST', headers: clientHeaders, url });

describe('fix guides', () => {
  it('shows where the problem is, without AI', async () => {
    const body = (await app.inject({ method: 'GET', url: `/tasks/${fixme.id}/guide` })).json<TaskGuideResponse>();
    expect(body.guide).toBeNull();
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0]).toMatchObject({ path: 'src/index.ts', line: 1, note: 'FIXME comment' });
  });

  it('asks the model for a guide, saves it and never touches the repository', async () => {
    const response = await post(`/tasks/${fixme.id}/guide`);
    expect(response.statusCode).toBe(200);
    expect(response.json<TaskGuideResponse>().guide).toMatchObject({
      taskId: fixme.id,
      explanation: 'Errors are not handled.',
      suggestions: [{ path: 'src/index.ts' }],
    });

    const again = (await app.inject({ method: 'GET', url: `/tasks/${fixme.id}/guide` })).json<TaskGuideResponse>();
    expect(again.guide?.explanation).toBe('Errors are not handled.');
    expect(await readFile(join(repoDir, 'src', 'index.ts'), 'utf8')).toContain('FIXME');
  });

  it('requires the client header to ask the model', async () => {
    const response = await app.inject({ method: 'POST', url: `/tasks/${fixme.id}/guide` });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /tasks/:id/check', () => {
  it('keeps the task open while the problem is still there', async () => {
    const body = (await post(`/tasks/${fixme.id}/check`)).json<CheckTaskResponse>();
    expect(body.fixed).toBe(false);
    expect(body.task.status).toBe('pending');
    expect(body.locations[0]?.line).toBe(1);
  });

  it('marks the task as done once the user fixed it, and reopens it if it comes back', async () => {
    await writeFile(join(repoDir, 'src', 'index.ts'), 'export const a = 1;\n');
    const body = (await post(`/tasks/${fixme.id}/check`)).json<CheckTaskResponse>();
    expect(body.fixed).toBe(true);
    expect(body.task.status).toBe('done');

    await writeFile(join(repoDir, 'src', 'index.ts'), '// FIXME: handle errors\n');
    const hunt = (await post(`/repositories/${fixme.repositoryId}/tasks/hunt`)).json<HuntResponse>();
    expect(hunt.tasks.find((t) => t.id === fixme.id)?.status).toBe('pending');
  });

  it('lets the user mark a task as done by hand', async () => {
    const response = await app.inject({
      method: 'PATCH',
      headers: clientHeaders,
      url: `/tasks/${fixme.id}`,
      payload: { status: 'done' },
    });
    expect(response.json<Task>().status).toBe('done');
  });

  it('returns 404 for unknown tasks', async () => {
    const response = await post('/tasks/00000000-0000-4000-8000-000000000000/check');
    expect(response.json<ApiError>().error).toBe('task-not-found');
  });
});
