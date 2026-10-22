import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, HuntResponse, Repository } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { clientHeaders } from './client-headers.js';
import { fakeGit } from './fake-git.js';
import { fakeOllama, model } from './fake-ollama.js';
import { memoryDb } from './memory-db.js';

let sandbox = '';
let app: FastifyInstance | undefined;

const aiAnswer = (titles: string[]) =>
  JSON.stringify({
    tasks: titles.map((title) => ({
      title,
      description: 'Descripción de la mejora.',
      category: 'refactor',
      priority: 'medium',
      complexity: 'small',
      risk: 'low',
      affectedFiles: ['src/form.ts', 'src/invented.ts'],
      suggestedImplementation: 'Hazlo así.',
    })),
  });

/** Creates a repo on disk, an app with the given fake Ollama, and adds the repo. */
async function setup(fake: ReturnType<typeof fakeOllama>) {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'sleepy-suggest-')));
  const repoDir = join(sandbox, 'demo');
  await mkdir(join(repoDir, '.git'), { recursive: true });
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'src', 'form.ts'), 'export function submit(data: unknown) {\n  return data;\n}\n');

  app = await buildApp({ database: memoryDb(), git: fakeGit(), ollama: fake.client });
  const response = await app.inject({ method: 'POST', headers: clientHeaders, url: '/repositories', payload: { path: repoDir } });
  return response.json<Repository>().id;
}

const suggest = (id: string) =>
  app!.inject({ method: 'POST', headers: clientHeaders, url: `/repositories/${id}/tasks/suggest` });

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(sandbox, { recursive: true, force: true });
});

describe('POST /repositories/:id/tasks/suggest', () => {
  it('saves the model suggestions as AI tasks', async () => {
    const fake = fakeOllama({ models: [model('gemma3:4b')], reply: aiAnswer(['Validar los datos en submit']) });
    const id = await setup(fake);

    const response = await suggest(id);
    expect(response.statusCode).toBe(200);

    const body = response.json<HuntResponse>();
    expect(body.added).toBe(1);
    const [task] = body.tasks.filter((t) => t.source === 'ai');
    expect(task).toMatchObject({
      title: 'Validar los datos en submit',
      status: 'pending',
      affectedFiles: ['src/form.ts'], // the invented file was dropped
    });
  });

  it('asks Gemma with a JSON schema and a bigger context window', async () => {
    const fake = fakeOllama({ models: [model('qwen2.5:3b'), model('gemma3:4b')], reply: aiAnswer([]) });
    const id = await setup(fake);
    await suggest(id);

    expect(fake.chatCalls).toEqual(['gemma3:4b']);
    expect(typeof fake.requests[0]?.format).toBe('object');
    expect(fake.requests[0]?.numCtx).toBe(8192);
  });

  it('replaces pending AI tasks but keeps approved ones', async () => {
    const fake = fakeOllama({ models: [model('gemma3:4b')], reply: aiAnswer(['Tarea uno de prueba', 'Tarea dos de prueba']) });
    const id = await setup(fake);
    const first = (await suggest(id)).json<HuntResponse>();
    const one = first.tasks.find((t) => t.title === 'Tarea uno de prueba')!;
    await app!.inject({ method: 'PATCH', headers: clientHeaders, url: `/tasks/${one.id}`, payload: { status: 'approved' } });

    // Second run: the model suggests something else.
    fake.setReply(aiAnswer(['Tarea tres de prueba']));
    const second = (await suggest(id)).json<HuntResponse>();

    const aiTasks = second.tasks
      .filter((t) => t.source === 'ai')
      .map((t) => [t.title, t.status])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
    expect(aiTasks).toEqual([
      ['Tarea tres de prueba', 'pending'],
      ['Tarea uno de prueba', 'approved'],
    ]);
    expect(second.removed).toBe(1); // "Tarea dos" was still pending
  });

  it('tells the model which tasks already exist', async () => {
    const fake = fakeOllama({ models: [model('gemma3:4b')], reply: aiAnswer([]) });
    const id = await setup(fake);
    await app!.inject({ method: 'POST', headers: clientHeaders, url: `/repositories/${id}/tasks/hunt` });
    await suggest(id);

    const prompt = fake.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('Add the first tests');
  });

  it('returns 409 when no model is installed', async () => {
    const id = await setup(fakeOllama({ models: [] }));
    const response = await suggest(id);
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiError>().error).toBe('no-model');
  });

  it('returns 503 when Ollama is off', async () => {
    const id = await setup(fakeOllama({ failWith: 'unreachable' }));
    const response = await suggest(id);
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiError>().error).toBe('unreachable');
  });

  it('returns 502 when the model answers with something that is not JSON', async () => {
    const id = await setup(fakeOllama({ models: [model('gemma3:4b')], reply: 'Claro, aquí tienes unas ideas…' }));
    const response = await suggest(id);
    expect(response.statusCode).toBe(502);
    expect(response.json<ApiError>().error).toBe('ai-invalid-output');
  });
});
