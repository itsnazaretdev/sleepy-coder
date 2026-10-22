import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createGitInspector, type GitInspector } from '@sleepy-coder/git';
import { createOllamaClient, type OllamaClient } from '@sleepy-coder/ollama';
import { CLIENT_HEADER, WEB_ORIGINS } from '@sleepy-coder/shared';
import { loadConfig, type ServerConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { ollamaRoutes } from './routes/ollama.js';
import { repositoryRoutes } from './routes/repositories.js';
import { systemRoutes } from './routes/system.js';
import { registerSecurity } from './security.js';
import { createFolderPicker, type FolderPicker } from './services/folder-picker.js';
import { createJsonRepositoryStore } from './store/repositories.js';

export interface BuildAppOptions {
  logger?: boolean;
  config?: Partial<ServerConfig>;
  /** Injected in tests to avoid talking to a real Ollama. */
  ollama?: OllamaClient;
  /** Injected in tests to avoid needing real Git repositories. */
  git?: GitInspector;
  /** Injected in tests so no real dialog is opened. */
  folderPicker?: FolderPicker;
}

/**
 * Creates the Fastify app without starting it.
 * Keeping creation and listening separate lets tests use `app.inject()`
 * without opening a real port.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: ServerConfig = { ...loadConfig(), ...options.config };
  const ollama = options.ollama ?? createOllamaClient({ baseUrl: config.ollamaUrl });
  const git = options.git ?? createGitInspector();
  const folderPicker = options.folderPicker ?? createFolderPicker();
  const store = createJsonRepositoryStore(join(config.dataDir, 'repositories.json'));

  const app = Fastify({ logger: options.logger ?? false });

  // Only the local Astro app may call the API from a browser.
  await app.register(cors, {
    origin: WEB_ORIGINS,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', CLIENT_HEADER],
  });
  registerSecurity(app);

  await app.register(healthRoutes);
  await app.register(ollamaRoutes, { client: ollama, configuredModel: config.model });
  await app.register(repositoryRoutes, { store, git });
  await app.register(systemRoutes, { folderPicker });

  return app;
}