import { execFileSync, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Playwright webServer 的自包含 API 引导：
 * 1. 启动真实 PostgreSQL 容器并应用已提交的迁移；
 * 2. 写入 .env.playwright（gitignore 覆盖，不进入 Git）；
 * 3. 前台启动 API dist 并转发信号；退出时停止容器。
 *
 * 必须自包含：Playwright 先启动 webServer、后运行 globalSetup，
 * 因此 API 不能依赖 globalSetup 产物。
 */

const apiDir = dirname(dirname(fileURLToPath(import.meta.url)));

const container = await new PostgreSqlContainer('postgres:17-alpine')
  .withDatabase('mc_plan_skin_e2e')
  .withUsername('mc_plan_skin')
  .withPassword('local-e2e-only')
  .start();
const databaseUrl = container.getConnectionUri();

try {
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  execFileSync(pnpmExecutable, ['migration:deploy'], {
    cwd: apiDir,
    env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
} catch (error) {
  console.error('[start-e2e] 迁移失败：', error instanceof Error ? error.name : String(error));
  await container.stop();
  process.exit(1);
}

const envContent = [
  'SKIN_RUN_MODE=standalone',
  'SKIN_ENV=test',
  'SKIN_API_HOST=127.0.0.1',
  'SKIN_API_PORT=4000',
  `SKIN_DATABASE_URL=${databaseUrl}`,
  'SKIN_CANDIDATE_STORAGE_ROOT=./data/candidates-e2e',
  '',
].join('\n');
await writeFile(join(apiDir, '.env.playwright'), envContent);

const child = spawn(
  process.execPath,
  ['--enable-source-maps', '--env-file=.env.playwright', 'dist/main.js'],
  { cwd: apiDir, stdio: 'inherit' },
);

const cleanup = async () => {
  child.kill();
  await container.stop();
  process.exit(0);
};

process.once('SIGTERM', () => {
  void cleanup();
});
process.once('SIGINT', () => {
  void cleanup();
});

child.on('exit', async (code) => {
  await container.stop();
  process.exit(code ?? 0);
});
