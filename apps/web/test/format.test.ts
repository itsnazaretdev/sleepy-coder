import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatUptime } from '../src/lib/format';

describe('formatUptime', () => {
  it('formats seconds only', () => {
    expect(formatUptime(0)).toBe('0 s');
    expect(formatUptime(42)).toBe('42 s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(125)).toBe('2 min 5 s');
  });

  it('formats hours and minutes, dropping seconds', () => {
    expect(formatUptime(3725)).toBe('1 h 2 min');
  });

  it('floors fractional seconds', () => {
    expect(formatUptime(59.9)).toBe('59 s');
  });

  it('returns a dash for invalid input', () => {
    expect(formatUptime(-1)).toBe('—');
    expect(formatUptime(Number.NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('formats small values in bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('uses one decimal below 10 units, with a Spanish comma', () => {
    expect(formatBytes(3_338_801_804)).toBe('3,3 GB');
    expect(formatBytes(1_929_912_432)).toBe('1,9 GB');
  });

  it('rounds to whole numbers from 10 units up', () => {
    expect(formatBytes(274_000_000)).toBe('274 MB');
  });

  it('returns a dash for invalid input', () => {
    expect(formatBytes(-5)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds as seconds', () => {
    expect(formatDuration(1234)).toBe('1,2 s');
  });

  it('returns a dash for null', () => {
    expect(formatDuration(null)).toBe('—');
  });
});
