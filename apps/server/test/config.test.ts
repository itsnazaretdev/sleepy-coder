import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses local defaults', () => {
    expect(loadConfig({})).toEqual({ ollamaUrl: 'http://127.0.0.1:11434', model: null });
  });

  it('reads SLEEPY_OLLAMA_URL and SLEEPY_MODEL', () => {
    expect(
      loadConfig({ SLEEPY_OLLAMA_URL: 'http://127.0.0.1:9999', SLEEPY_MODEL: ' qwen2.5:3b ' }),
    ).toEqual({ ollamaUrl: 'http://127.0.0.1:9999', model: 'qwen2.5:3b' });
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ SLEEPY_OLLAMA_URL: '', SLEEPY_MODEL: '   ' })).toEqual({
      ollamaUrl: 'http://127.0.0.1:11434',
      model: null,
    });
  });
});
