import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, PickFolderResponse } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';
import { hostnameOf } from '../src/security.js';
import type { FolderPicker } from '../src/services/folder-picker.js';
import { clientHeaders } from './client-headers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakePicker(result: string | null): FolderPicker & { calls: number } {
  const picker = {
    supported: true,
    calls: 0,
    async pick() {
      picker.calls += 1;
      return result;
    },
  };
  return picker;
}

describe('hostnameOf', () => {
  it.each([
    ['127.0.0.1:4317', '127.0.0.1'],
    ['localhost', 'localhost'],
    ['LOCALHOST:4317', 'localhost'],
    ['[::1]:4317', '[::1]'],
    ['evil.example.com:4317', 'evil.example.com'],
  ])('%s → %s', (header, hostname) => {
    expect(hostnameOf(header)).toBe(hostname);
  });

  it('returns an empty string without a Host header', () => {
    expect(hostnameOf(undefined)).toBe('');
  });
});

describe('request protection', () => {
  it('rejects requests addressed to another host (DNS rebinding)', async () => {
    app = await buildApp({ folderPicker: fakePicker(null) });
    const response = await app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example.com:4317' } });

    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error).toBe('forbidden-host');
  });

  it('allows GET without the client header', async () => {
    app = await buildApp({ folderPicker: fakePicker(null) });
    const response = await app.inject({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:4317' } });
    expect(response.statusCode).toBe(200);
  });

  it('rejects POST without the client header and does not run the action', async () => {
    const picker = fakePicker('/x');
    app = await buildApp({ folderPicker: picker });
    const response = await app.inject({ method: 'POST', url: '/system/pick-folder' });

    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error).toBe('missing-client-header');
    expect(picker.calls).toBe(0);
  });

  it('answers the CORS preflight for the local web app, allowing the client header', async () => {
    app = await buildApp({ folderPicker: fakePicker(null) });
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/system/pick-folder',
      headers: {
        origin: 'http://127.0.0.1:4321',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-sleepy-client',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4321');
    expect(String(response.headers['access-control-allow-headers'])).toContain('x-sleepy-client');
  });
});

describe('POST /system/pick-folder', () => {
  it('returns the chosen path', async () => {
    app = await buildApp({ folderPicker: fakePicker('/Users/naz/Desktop/sleepy-coder') });
    const response = await app.inject({ method: 'POST', url: '/system/pick-folder', headers: clientHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json<PickFolderResponse>()).toEqual({ path: '/Users/naz/Desktop/sleepy-coder' });
  });

  it('returns null when the dialog is cancelled', async () => {
    app = await buildApp({ folderPicker: fakePicker(null) });
    const response = await app.inject({ method: 'POST', url: '/system/pick-folder', headers: clientHeaders });

    expect(response.json<PickFolderResponse>()).toEqual({ path: null });
  });
});