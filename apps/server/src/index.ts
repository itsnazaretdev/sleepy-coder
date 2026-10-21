import { SERVER_HOST, SERVER_PORT } from '@sleepy-coder/shared';
import { buildApp } from './app.js';

const app = await buildApp({ logger: true });

try {
  // Loopback only: the service must never be reachable from the network.
  await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
