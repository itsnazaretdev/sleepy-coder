// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static output (SSG): data comes from the Fastify backend at runtime,
// fetched by React Islands. No Astro server, no API routes.
export default defineConfig({
  output: 'static',
  integrations: [react()],
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
});
