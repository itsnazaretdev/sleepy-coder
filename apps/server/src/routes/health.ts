import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@sleepy-coder/shared';

const VERSION = '0.1.0';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'sleepy-coder-server',
    version: VERSION,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));
}
