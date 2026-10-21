import { describe, expect, it } from 'vitest';
import { normalizeModelName, selectModel, type OllamaModel } from '../src/index.js';

const model = (name: string): OllamaModel => ({
  name,
  sizeBytes: 0,
  family: null,
  parameterSize: null,
  quantization: null,
  modifiedAt: '',
});

const installed = [model('qwen2.5:3b'), model('gemma3:4b')];

describe('normalizeModelName', () => {
  it('adds :latest when there is no tag', () => {
    expect(normalizeModelName('gemma3')).toBe('gemma3:latest');
  });

  it('keeps explicit tags', () => {
    expect(normalizeModelName(' gemma3:4b ')).toBe('gemma3:4b');
  });
});

describe('selectModel', () => {
  it('prefers a Gemma model when nothing is configured', () => {
    expect(selectModel(installed, null)).toEqual({ name: 'gemma3:4b', available: true, source: 'auto' });
  });

  it('falls back to the first model if there is no Gemma', () => {
    expect(selectModel([model('qwen2.5:3b')], null)).toEqual({
      name: 'qwen2.5:3b',
      available: true,
      source: 'auto',
    });
  });

  it('returns none when no models are installed', () => {
    expect(selectModel([], null)).toEqual({ name: null, available: false, source: 'none' });
  });

  it('uses the configured model when installed', () => {
    expect(selectModel(installed, 'qwen2.5:3b')).toEqual({
      name: 'qwen2.5:3b',
      available: true,
      source: 'configured',
    });
  });

  it('matches a configured name without tag against :latest', () => {
    expect(selectModel([model('llama3.2:latest')], 'llama3.2')).toEqual({
      name: 'llama3.2:latest',
      available: true,
      source: 'configured',
    });
  });

  it('keeps a configured model that is not installed, marked unavailable', () => {
    expect(selectModel(installed, 'mistral:7b')).toEqual({
      name: 'mistral:7b',
      available: false,
      source: 'configured',
    });
  });
});
