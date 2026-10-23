import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, HuntResponse, Repository, Task } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { clientHeaders } from './client-headers.js';
import { fakeGit } from './fake-git.js';
import { memoryDb } from './memory-db.js';

let sandbox = '';
let repoDir = '';
let app: FastifyInstance;
let repoId = '';

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-tasks-api-')));
  repoDir = join(sandbox, 'demo');
  await mkdir(join(repoDir, '.git'), { recursive: true });
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'README.md'), '# demo');
  await writeFile(join(repoDir, 'src', 'index.ts'), '// FIXME: handle errors\nexport const a = 1;\n');

  app = await buildApp({ database: memoryDb(), git: fakeGit() });
  const response = await app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: { path: repoDir } });
  repoId = response.json<Repository>().id;
});

afterEach(async () => {
  await app.close();
  await rm(sandbox, { recursive: true, force: true });
});

const hunt = (id = repoId) => app.inject({ method: 'POST', headers: clientHeaders, url: `/repositories/${id}/tasks/hunt` });
const list = (query = '') => app.inject({ method: 'GET', url: `/repositories/${repoId}/tasks${query}` });
const patch = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', headers: clientHeaders, url: `/tasks/${id}`, payload });

describe('POST /repositories/:id/tasks/hunt', () => {
  it('finds static tasks and returns them, most important first', async () => {
    const response = await hunt();
    expect(response.statusCode).toBe(200);

    const body = response.json<HuntResponse>();
    expect(body.added).toBe(3);
    expect(body.tasks.map((t) => t.title)).toEqual([
      'FIXME: handle errors',
      'Add the first tests',
      'Add a license',
    ]);
    expect(body.tasks.every((t) => t.status === 'pending' && t.repositoryId === repoId)).toBe(true);
  });

  it('removes pending tasks that were fixed in the meantime', async () => {
    await hunt();
    await writeFile(join(repoDir, 'src', 'index.ts'), 'export const a = 1;\n');

    const body = (await hunt()).json<HuntResponse>();
    expect(body.removed).toBe(1);
    expect(body.tasks.map((t) => t.category)).not.toContain('todo');
  });

  it('returns 404 for an unknown repository', async () => {
    const response = await hunt('bbbbbbbbbbbb');
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error).toBe('repository-not-found');
  });

  it('reports a repository whose folder was deleted', async () => {
    await rm(repoDir, { recursive: true });
    const response = await hunt();
    expect(response.statusCode).toBe(422);
    expect(response.json<ApiError>().error).toBe('not-found');
  });

  it('requires the client header', async () => {
    const response = await app.inject({ method: 'POST', url: `/repositories/${repoId}/tasks/hunt` });
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /repositories/:id/tasks', () => {
  it('is empty before hunting', async () => {
    expect((await list()).json()).toEqual([]);
  });

  it('filters by status and validates the filter', async () => {
    await hunt();
    const [first] = (await list()).json<Task[]>();
    await patch(first!.id, { status: 'approved' });

    expect((await list('?status=approved')).json<Task[]>()).toHaveLength(1);
    expect((await list('?status=pending')).json<Task[]>()).toHaveLength(2);
    expect((await list('?status=nope')).statusCode).toBe(400);
  });
});

describe('PATCH /tasks/:id', () => {
  it('approves and discards tasks', async () => {
    await hunt();
    const [first] = (await list()).json<Task[]>();

    const approved = await patch(first!.id, { status: 'approved' });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<Task>().status).toBe('approved');

    const discarded = await patch(first!.id, { status: 'discarded' });
    expect(discarded.json<Task>().status).toBe('discarded');
  });

  it('rejects invalid statuses and unknown tasks', async () => {
    await hunt();
    const [first] = (await list()).json<Task[]>();

    expect((await patch(first!.id, { status: 'finished' })).statusCode).toBe(400);
    const missing = await patch('00000000-0000-4000-8000-000000000000', { status: 'approved' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiError>().error).toBe('task-not-found');
  });
});