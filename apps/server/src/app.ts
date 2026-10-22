import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createGitInspector, type GitInspector } from '@sleepy-coder/git';
import { createOllamaClient, type OllamaClient } from '@sleepy-coder/ollama';
import { CLIENT_HEADER, WEB_ORIGINS } from '@sleepy-coder/shared';
import { loadConfig, type ServerConfig } from './config.js';
import { openDatabase, type Database } from './db/database.js';
import { healthRoutes } from './routes/health.js';
import { ollamaRoutes } from './routes/ollama.js';
import { repositoryRoutes } from './routes/repositories.js';
import { systemRoutes } from './routes/system.js';
import { taskRoutes } from './routes/tasks.js';
import { registerSecurity } from './security.js';
import { createFolderPicker, type FolderPicker } from './services/folder-picker.js';
import { createSqliteRepositoryStore, importLegacyRepositories } from './store/repositories.js';
import { createSqliteTaskStore } from './store/tasks.js';

export interface BuildAppOptions {
  logger?: boolean;
  config?: Partial<ServerConfig>;
  /** Injected in tests (usually an in-memory database). */
  database?: Database;
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

  const app = Fastify({ logger: options.logger ?? false });

  let db = options.database;
  if (!db) {
    db = openDatabase(join(config.dataDir, 'sleepy-coder.db'));
    // Repositories saved by Phase 3 move into the database once.
    const imported = importLegacyRepositories(db, join(config.dataDir, 'repositories.json'));
    if (imported > 0) app.log.info(`Imported ${imported} repositories from repositories.json`);
  }
  const database = db;
  app.addHook('onClose', async () => database.close());

  const store = createSqliteRepositoryStore(database);
  const tasks = createSqliteTaskStore(database);

  // Only the local Astro app may call the API from a browser.
  await app.register(cors, {
    origin: WEB_ORIGINS,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CLIENT_HEADER],
  });
  registerSecurity(app);

  await app.register(healthRoutes);
  await app.register(ollamaRoutes, { client: ollama, configuredModel: config.model });
  await app.register(repositoryRoutes, { store, git });
  await app.register(taskRoutes, { store, git, tasks });
  await app.register(systemRoutes, { folderPicker });

  return app;
}
