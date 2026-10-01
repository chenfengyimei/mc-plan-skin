import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 150_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: [
    {
      // 自包含：启动 PostgreSQL + Redis 容器、应用迁移并拉起 API 与 worker dist
      command: 'node scripts/start-stack-e2e.mjs',
      url: 'http://127.0.0.1:4000/health/live',
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: 'pnpm --filter @mc-plan/skin-web dev',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
