import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createOllamaClient, type OllamaClient } from '@sleepy-coder/ollama';
import { WEB_ORIGINS } from '@sleepy-coder/shared';
import { loadConfig, type ServerConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { ollamaRoutes } from './routes/ollama.js';

export interface BuildAppOptions {
  logger?: boolean;
  config?: Partial<ServerConfig>;
  /** Injected in tests to avoid talking to a real Ollama. */
  ollama?: OllamaClient;
}

/**
 * Creates the Fastify app without starting it.
 * Keeping creation and listening separate lets tests use `app.inject()`
 * without opening a real port.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: ServerConfig = { ...loadConfig(), ...options.config };
  const ollama = options.ollama ?? createOllamaClient({ baseUrl: config.ollamaUrl });

  const app = Fastify({ logger: options.logger ?? false });

  // Only the local Astro app may call the API from a browser.
  await app.register(cors, { origin: WEB_ORIGINS, methods: ['GET', 'POST'] });

  await app.register(healthRoutes);
  await app.register(ollamaRoutes, { client: ollama, configuredModel: config.model });

  return app;
}
