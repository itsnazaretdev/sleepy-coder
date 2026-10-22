import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository } from '@sleepy-coder/shared';

/**
 * Saved repositories. A small JSON file for now; it will move to SQLite when
 * tasks and history need real queries (Phase 4). The interface stays the same.
 */
export interface RepositoryStore {
  list(): Promise<Repository[]>;
  get(id: string): Promise<Repository | null>;
  add(repository: Repository): Promise<void>;
  /** Returns false if there was nothing to remove. */
  remove(id: string): Promise<boolean>;
}

interface FileShape {
  version: 1;
  repositories: Repository[];
}

export function createJsonRepositoryStore(filePath: string): RepositoryStore {
  // Writes are chained so two quick requests never overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Repository[]> {
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8')) as Partial<FileShape>;
      return Array.isArray(data.repositories) ? data.repositories : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async function write(repositories: Repository[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const content: FileShape = { version: 1, repositories };
    // Write to a temp file and rename: a crash never leaves a half-written file.
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`);
    await rename(tmp, filePath);
  }

  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    list: () => serialized(read),

    get: (id) => serialized(async () => (await read()).find((r) => r.id === id) ?? null),

    add: (repository) =>
      serialized(async () => {
        const repositories = await read();
        await write([...repositories, repository]);
      }),

    remove: (id) =>
      serialized(async () => {
        const repositories = await read();
        const remaining = repositories.filter((r) => r.id !== id);
        if (remaining.length === repositories.length) return false;
        await write(remaining);
        return true;
      }),
  };
}
