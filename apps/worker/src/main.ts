import 'dotenv/config';
import pino, { type Logger } from 'pino';
import { Queue, Worker } from 'bullmq';

import { loadWorkerConfig } from '@mc-plan/skin-config';
import { SystemClock, QUEUE_NAMES } from '@mc-plan/skin-core';
import { createPrismaClient } from '@mc-plan/skin-db';
import { FakeProvider } from '@mc-plan/skin-provider-sdk';
import { FileSystemObjectStorage } from '@mc-plan/skin-core';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';

import { processFinalizeJob } from './finalize.processor.js';
import { processRenderJob } from './render.processor.js';
import { runRetentionCleanup } from './retention.processor.js';
import type { WorkerContext } from './worker-context.js';

const config = loadWorkerConfig(process.env);

const logger: Logger = pino({
  level: config.logLevel,
  base: { service: 'skin-worker', environment: config.env, run_mode: config.runMode },
  redact: {
    paths: ['SKIN_DATABASE_URL', 'SKIN_REDIS_URL', 'password'],
    censor: '[REDACTED]',
  },
  messageKey: 'event',
});

const db = createPrismaClient(config.databaseUrl);
const storage = new FileSystemObjectStorage(config.candidateStorageRoot);
const clock = new SystemClock();

// Fake Provider 仅在开发/测试环境可用（ADR-0009：生产模式禁止实例化）；
// 正式厂商适配器在基准 ADR（Q-001）决定后接入同一接口。
const provider = new FakeProvider({
  environment: config.env,
  resolveFixture: async (request) =>
    loadFixtureBytes(request.armModel === 'alex' ? 'valid-alex' : 'valid-steve'),
});

const ctx: WorkerContext = {
  db,
  storage,
  provider,
  clock,
  logger,
  candidateRetentionHours: config.candidateRetentionHours,
};

const connection = { url: config.redisUrl };

const renderWorker = new Worker(QUEUE_NAMES.render, (job) => processRenderJob(ctx, job.data, job), {
  connection,
  concurrency: 2,
  // 可重试的提供商错误（限流/超时等）由 BullMQ 指数退避重试
  settings: {},
});
const finalizeWorker = new Worker(
  QUEUE_NAMES.finalize,
  (job) => processFinalizeJob(ctx, job.data),
  { connection, concurrency: 2 },
);

const retentionQueue = new Queue(QUEUE_NAMES.retentionCleanup, { connection });
const retentionWorker = new Worker(
  QUEUE_NAMES.retentionCleanup,
  async () => {
    await runRetentionCleanup(ctx);
  },
  { connection, concurrency: 1 },
);
await retentionQueue.upsertJobScheduler(
  'retention-hourly',
  { every: 60 * 60 * 1000 },
  {
    name: 'retention',
    data: {},
  },
);

logger.info({
  event: 'worker_starting',
  result: 'success',
  queues: [QUEUE_NAMES.render, QUEUE_NAMES.finalize, QUEUE_NAMES.retentionCleanup],
  retention: {
    conversation_days: config.conversationRetentionDays,
    candidate_hours: config.candidateRetentionHours,
  },
});

const shutdown = async (): Promise<void> => {
  logger.info({ event: 'worker_stopping', result: 'success' });
  await renderWorker.close();
  await finalizeWorker.close();
  await retentionWorker.close();
  await retentionQueue.close();
  await db.$disconnect();
};

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
