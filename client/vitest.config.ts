import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Same alias as vite.config.ts: the shared package is consumed from source.
    alias: { '@polyball/shared': resolvePath('../shared/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
