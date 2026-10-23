import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The agent tests create real Git repositories and run `npm test`: they need more than 5 s.
    testTimeout: 60_000,
  },
});
