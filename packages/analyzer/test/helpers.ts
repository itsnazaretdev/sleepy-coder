import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Creates a temporary folder with the given files.
 * Keys are relative paths, values are file contents.
 */
export async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sleepy-analyzer-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

export function removeFixture(root: string): Promise<void> {
  return rm(root, { recursive: true, force: true });
}
