import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses local defaults', () => {
    const config = loadConfig({});

    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(config.model).toBeNull();
    // Default data dir is <repo root>/data, regardless of the working directory.
    expect(config.dataDir.replaceAll('\\', '/')).toMatch(/\/data$/);
    expect(config.dataDir).not.toMatch(/apps[\\/]server/);
  });

  it('reads the SLEEPY_* variables', () => {
    expect(
      loadConfig({
        SLEEPY_OLLAMA_URL: 'http://127.0.0.1:9999',
        SLEEPY_MODEL: ' gemma3:4b ',
        SLEEPY_DATA_DIR: '/tmp/sleepy',
      }),
    ).toEqual({ ollamaUrl: 'http://127.0.0.1:9999', model: 'gemma3:4b', dataDir: '/tmp/sleepy' });
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({ SLEEPY_OLLAMA_URL: '', SLEEPY_MODEL: '   ' });

    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(config.model).toBeNull();
  });
});
