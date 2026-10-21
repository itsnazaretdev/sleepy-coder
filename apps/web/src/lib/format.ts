/**
 * Formats a number of seconds as a short, human-readable duration in Spanish.
 * Examples: 42 → "42 s", 125 → "2 min 5 s", 3725 → "1 h 2 min".
 */
export function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—';
  }

  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

/**
 * Formats a byte count using decimal units, like `ollama list` does.
 * Examples: 512 → "512 B", 1_900_000_000 → "1,9 GB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';

  for (const next of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }

  const rounded = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded.replace('.', ',')} ${unit}`;
}

/**
 * Formats milliseconds as seconds with one decimal, Spanish style.
 * Example: 1234 → "1,2 s".
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
