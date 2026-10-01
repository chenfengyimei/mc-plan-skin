import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

/**
 * Playwright webServer 的自包含后端栈：
 * 1. 启动真实 PostgreSQL 与 Redis 容器；
 * 2. 应用已提交的迁移（packages/db）；
 * 3. 以显式环境变量拉起 API dist 与 worker dist（共享同一候选存储根）；
 * 4. 退出时清理子进程与容器（异常终止时由 testcontainers 回收器兜底）。
 *
 * 必须自包含：Playwright 先启动 webServer、后运行 globalSetup。
 */

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const postgres = await new PostgreSqlContainer('postgres:17-alpine')
  .withDatabase('mc_plan_skin_e2e')
  .withUsername('mc_plan_skin')
  .withPassword('local-e2e-only')
  .start();
const redis = await new RedisContainer('redis:7-alpine').start();

const databaseUrl = postgres.getConnectionUri();
const redisUrl = redis.getConnectionUrl();

try {
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  execFileSync(pnpmExecutable, ['migration:deploy'], {
    cwd: join(rootDir, 'packages', 'db'),
    env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
} catch (error) {
  console.error(
    '[start-stack-e2e] 迁移失败：',
    error instanceof Error ? error.name : String(error),
  );
  await Promise.all([postgres.stop(), redis.stop()]);
  process.exit(1);
}

const sharedEnv = {
  ...process.env,
  SKIN_RUN_MODE: 'standalone',
  SKIN_ENV: 'test',
  SKIN_LOG_LEVEL: 'warn',
  SKIN_DATABASE_URL: databaseUrl,
  SKIN_REDIS_URL: redisUrl,
  SKIN_API_HOST: '127.0.0.1',
  SKIN_API_PORT: '4000',
  SKIN_CANDIDATE_STORAGE_ROOT: join(rootDir, 'data', 'e2e-candidates'),
};

const children = [
  spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: join(rootDir, 'apps', 'api'),
    env: sharedEnv,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: join(rootDir, 'apps', 'worker'),
    env: sharedEnv,
    stdio: 'inherit',
  }),
];

let exiting = false;
const cleanup = async (code) => {
  if (exiting) {
    return;
  }
  exiting = true;
  for (const child of children) {
    child.kill();
  }
  await Promise.all([postgres.stop(), redis.stop()]);
  process.exit(code ?? 0);
};

process.once('SIGTERM', () => void cleanup(0));
process.once('SIGINT', () => void cleanup(0));
for (const child of children) {
  child.on('exit', (code) => void cleanup(code ?? 0));
}
