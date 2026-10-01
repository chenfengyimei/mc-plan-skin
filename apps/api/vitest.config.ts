import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mc-plan/skin-config': fileURLToPath(
        new URL('../../packages/config/src/index.ts', import.meta.url),
      ),
      '@mc-plan/skin-contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@mc-plan/skin-core': fileURLToPath(
        new URL('../../packages/skin-core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
