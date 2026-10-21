import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@sleepy-coder/shared';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 200 with the service status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('sleepy-coder-server');
    expect(typeof body.uptime).toBe('number');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('allows CORS from the local web app', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:4321' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4321');
  });

  it('does not allow CORS from other origins', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
