import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: [
    {
      // 自包含：脚本内部启动 PostgreSQL 容器、应用迁移并以 .env.playwright 引导 dist
      command: 'pnpm --filter @mc-plan/skin-api start:e2e',
      url: 'http://127.0.0.1:4000/health/live',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @mc-plan/skin-web dev',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
