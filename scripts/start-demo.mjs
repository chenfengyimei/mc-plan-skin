import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

/**
 * 本地演示引导：PostgreSQL + Redis 容器 → 迁移 → API / worker / Web 三进程。
 * 长驻运行；Ctrl+C 或 SIGTERM 时清理子进程与容器。
 */

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const providerArgument = process.argv.find((argument) => argument.startsWith('--provider='));
const provider = providerArgument?.split('=', 2)[1] ?? 'fake';
if (!['fake', 'llm', 'image'].includes(provider)) {
  console.error('[local] --provider 只支持 fake、llm 或 image');
  process.exit(1);
}

console.log(
  `[local] 启动模式：${provider === 'llm' ? '真实 LLM Provider' : provider === 'image' ? '真实图像→视觉提取管线（固定概念图 + 真实视觉提取）' : '固定 Fake fixture'}`,
);

// image 模式注入固定概念图 fixture（显式演示/测试注入点）：
// 图像跳固定、视觉跳走真实远程配置（apps/worker/.env 的 SKIN_LLM_*/SKIN_VISION_*）。
const imageFixtureEnv =
  provider === 'image'
    ? {
        SKIN_IMAGE_FIXTURE_PATH: join(
          rootDir,
          'packages',
          'test-fixtures',
          'assets',
          'concept-explorer.png',
        ),
      }
    : {};
console.log('[demo] 启动 PostgreSQL 与 Redis 容器…');
const postgres = await new PostgreSqlContainer('postgres:17-alpine')
  .withDatabase('skin')
  .withUsername('skin')
  .withPassword('local-only')
  .start();
const redis = await new RedisContainer('redis:7-alpine').start();
const databaseUrl = postgres.getConnectionUri();
const redisUrl = redis.getConnectionUrl();
console.log('[demo] 容器就绪');

try {
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  execFileSync(pnpmExecutable, ['migration:deploy'], {
    cwd: join(rootDir, 'packages', 'db'),
    env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
  console.log('[demo] 迁移已应用');
} catch (error) {
  console.error('[demo] 迁移失败：', error instanceof Error ? error.name : String(error));
  await Promise.all([postgres.stop(), redis.stop()]);
  process.exit(1);
}

const sharedEnv = {
  ...process.env,
  SKIN_RUN_MODE: 'standalone',
  SKIN_ENV: 'development',
  // 启动入口必须显式决定 Provider：真实模式缺少连接配置时由 worker 配置校验直接失败，
  // 绝不静默降级为会重复返回 fixture 的 Fake Provider。
  SKIN_PROVIDER: provider,
  SKIN_LOG_LEVEL: 'info',
  SKIN_DATABASE_URL: databaseUrl,
  SKIN_REDIS_URL: redisUrl,
  SKIN_API_HOST: '127.0.0.1',
  SKIN_API_PORT: '4000',
  SKIN_CANDIDATE_STORAGE_ROOT: join(rootDir, 'data', 'demo-candidates'),
  SKIN_OFFICIAL_CORE_BASE_URL: '',
  ...imageFixtureEnv,
};

// 真实模式的 SKIN_LLM_* 由 apps/worker/.env（gitignored）提供；dotenv 不覆盖这里显式
// 选择的 SKIN_PROVIDER。密钥只留在本地文件，绝不写入 Git 或日志。

const children = [];
// 不使用 shell:true：Windows 下含空格的 node 路径会被截断
const spawnChild = (args, cwd) => {
  const child = spawn(process.execPath, args, { cwd, env: sharedEnv, stdio: 'inherit' });
  children.push(child);
  return child;
};

console.log('[demo] 启动 API (127.0.0.1:4000)…');
spawnChild(['--enable-source-maps', 'dist/main.js'], join(rootDir, 'apps', 'api'));
console.log('[demo] 启动 worker…');
spawnChild(['--enable-source-maps', 'dist/main.js'], join(rootDir, 'apps', 'worker'));
console.log('[demo] 启动 Web (127.0.0.1:3100)…');
spawnChild(
  [
    join(rootDir, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'),
    'start',
    '-p',
    '3100',
  ],
  join(rootDir, 'apps', 'web'),
);

console.log('[demo] 全部服务已拉起：');
console.log('  - 网站:      http://127.0.0.1:3100');
console.log('  - API 健康:  http://127.0.0.1:4000/health/live');
console.log('  - API 就绪:  http://127.0.0.1:4000/health/ready');

let exiting = false;
const cleanup = async (code) => {
  if (exiting) {
    return;
  }
  exiting = true;
  console.log('[demo] 正在停止服务与容器…');
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
