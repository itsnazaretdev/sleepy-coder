import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests create real Git repositories and run the agent end to end.
    testTimeout: 30_000,
  },
});
