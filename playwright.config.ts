import { defineConfig } from '@playwright/test';

function e2ePort(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${name} 必须是 1024-65535 的端口号`);
  }
  return value;
}

const apiPort = e2ePort('SKIN_E2E_API_PORT', 4000);
const webPort = e2ePort('SKIN_E2E_WEB_PORT', 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 150_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: [
    {
      // 自包含：启动 PostgreSQL + Redis 容器、应用迁移并拉起 API 与 worker dist
      command: 'node scripts/start-stack-e2e.mjs',
      url: `http://127.0.0.1:${apiPort}/health/live`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `pnpm --filter @mc-plan/skin-web exec next dev -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        SKIN_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
