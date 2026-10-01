import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mc-plan/skin-core': fileURLToPath(new URL('../skin-core/src/index.ts', import.meta.url)),
      '@mc-plan/skin-contracts': fileURLToPath(
        new URL('../contracts/src/index.ts', import.meta.url),
      ),
      '@mc-plan/skin-validator': fileURLToPath(
        new URL('../skin-validator/src/index.ts', import.meta.url),
      ),
      '@mc-plan/skin-test-fixtures': fileURLToPath(
        new URL('../test-fixtures/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
