import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, Repository, RepositoryReport } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { buildWarnings, expandHome, repositoryId } from '../src/services/repositories.js';
import { clientHeaders } from './client-headers.js';
import { cleanGitInfo, fakeGit } from './fake-git.js';

let sandbox = '';
let dataDir = '';
let repoDir = '';
let app: FastifyInstance;

async function createApp(gitInfo = {}) {
  app = await buildApp({ git: fakeGit(gitInfo), config: { dataDir } });
  return app;
}

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-server-')));
  dataDir = join(sandbox, 'data');
  repoDir = join(sandbox, 'my-project');

  await mkdir(join(repoDir, '.git'), { recursive: true });
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '3' } }));
  await writeFile(join(repoDir, 'src', 'index.ts'), 'export const answer = 42;\n');
});

afterEach(async () => {
  await app?.close();
  await rm(sandbox, { recursive: true, force: true });
});

const add = (path: string) => app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: { path } });

describe('POST /repositories', () => {
  it('adds a valid repository and persists it', async () => {
    await createApp();
    const response = await add(repoDir);

    expect(response.statusCode).toBe(201);
    const repo = response.json<Repository>();
    expect(repo).toMatchObject({ id: repositoryId(repoDir), name: 'my-project', path: repoDir });

    expect(existsSync(join(dataDir, 'sleepy-coder.db'))).toBe(true);
  });

  it('imports repositories saved by Phase 3 (repositories.json) once', async () => {
    const legacy: Repository = { id: repositoryId(repoDir), name: 'my-project', path: repoDir, addedAt: '2026-10-21T10:00:00.000Z' };
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'repositories.json'), JSON.stringify({ version: 1, repositories: [legacy] }));

    await createApp();
    const list = (await app.inject({ method: 'GET', url: '/repositories' })).json<Repository[]>();

    expect(list).toEqual([legacy]);
    expect(existsSync(join(dataDir, 'repositories.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'repositories.json.imported'))).toBe(true);
  });

  it.each([
    ['relative/path', 'invalid-path'],
    ['/definitely/not/here/12345', 'not-found'],
  ])('rejects %s with %s', async (path, code) => {
    await createApp();
    const response = await add(path);

    expect(response.statusCode).toBe(422);
    expect(response.json<ApiError>().error).toBe(code);
  });

  it('rejects a file', async () => {
    await createApp();
    const response = await add(join(repoDir, 'package.json'));
    expect(response.json<ApiError>().error).toBe('not-a-directory');
  });

  it('rejects a folder that is not a Git repository root', async () => {
    await createApp();
    const response = await add(join(repoDir, 'src'));
    expect(response.json<ApiError>().error).toBe('not-a-git-repo');
  });

  it('rejects duplicates, also through a trailing slash', async () => {
    await createApp();
    await add(repoDir);
    const response = await add(`${repoDir}/`);

    expect(response.statusCode).toBe(409);
    expect(response.json<ApiError>().error).toBe('already-added');
  });

  it('validates the body', async () => {
    await createApp();
    const response = await app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /repositories', () => {
  it('starts empty and lists added repositories', async () => {
    await createApp();
    expect((await app.inject({ method: 'GET', url: '/repositories' })).json()).toEqual([]);

    await add(repoDir);
    const list = (await app.inject({ method: 'GET', url: '/repositories' })).json<Repository[]>();
    expect(list.map((r) => r.name)).toEqual(['my-project']);
  });

  it('keeps repositories after a restart', async () => {
    await createApp();
    await add(repoDir);
    await app.close();

    await createApp();
    const list = (await app.inject({ method: 'GET', url: '/repositories' })).json<Repository[]>();
    expect(list).toHaveLength(1);
  });
});

describe('DELETE /repositories/:id', () => {
  it('removes a repository from the list (not from disk)', async () => {
    await createApp();
    const { id } = (await add(repoDir)).json<Repository>();

    const response = await app.inject({ method: 'DELETE', headers: clientHeaders, url: `/repositories/${id}` });
    expect(response.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/repositories' })).json()).toEqual([]);
    await expect(readFile(join(repoDir, 'package.json'), 'utf8')).resolves.toContain('vitest');
  });

  it('returns 404 for an unknown id', async () => {
    await createApp();
    const response = await app.inject({ method: 'DELETE', headers: clientHeaders, url: '/repositories/aaaaaaaaaaaa' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects malformed ids', async () => {
    await createApp();
    const response = await app.inject({ method: 'DELETE', headers: clientHeaders, url: '/repositories/..%2F..%2Fetc' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /repositories/:id/analysis', () => {
  it('returns the structure, git info and warnings', async () => {
    await createApp({ isClean: false, changedFiles: 2 });
    const { id } = (await add(repoDir)).json<Repository>();

    const response = await app.inject({ method: 'GET', url: `/repositories/${id}/analysis` });
    expect(response.statusCode).toBe(200);

    const report = response.json<RepositoryReport>();
    expect(report.repository.id).toBe(id);
    expect(report.languages.map((l) => l.language)).toEqual(['TypeScript']);
    expect(report.testingTools).toEqual(['Vitest']);
    expect(report.git.changedFiles).toBe(2);
    expect(report.warnings).toEqual(['uncommitted-changes', 'no-tests', 'no-readme', 'no-license']);
  });

  it('reports a repository whose folder was deleted', async () => {
    await createApp();
    const { id } = (await add(repoDir)).json<Repository>();
    await rm(repoDir, { recursive: true });

    const response = await app.inject({ method: 'GET', url: `/repositories/${id}/analysis` });
    expect(response.json<ApiError>().error).toBe('not-found');
  });

  it('returns 404 for an unknown id', async () => {
    await createApp();
    const response = await app.inject({ method: 'GET', url: '/repositories/aaaaaaaaaaaa/analysis' });
    expect(response.statusCode).toBe(404);
  });
});

describe('helpers', () => {
  it('expandHome expands ~ only at the start', () => {
    expect(expandHome('~/code/app', '/Users/naz')).toBe('/Users/naz/code/app');
    expect(expandHome('~', '/Users/naz')).toBe('/Users/naz');
    expect(expandHome('  /abs/path  ', '/Users/naz')).toBe('/abs/path');
    expect(expandHome('/a/~/b', '/Users/naz')).toBe('/a/~/b');
  });

  it('buildWarnings returns nothing for a tidy repository', () => {
    const structure = {
      files: { total: 3, totalBytes: 10, testFiles: 1, truncated: false },
      languages: [],
      packageManagers: [],
      frameworks: [],
      testingTools: [],
      configFiles: [],
      hasReadme: true,
      hasLicense: true,
    };
    expect(buildWarnings(structure, cleanGitInfo)).toEqual([]);
  });
});
