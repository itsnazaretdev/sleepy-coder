import { defineConfig } from 'vitest/config';

// Plain Vitest config for pure TypeScript logic (no Astro/DOM needed yet).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
