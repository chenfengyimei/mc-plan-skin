import 'dotenv/config';
import pino, { type Logger } from 'pino';

import { loadWorkerConfig } from '@mc-plan/skin-config';
import { SystemClock, FileSystemObjectStorage } from '@mc-plan/skin-core';
import { createPrismaClient } from '@mc-plan/skin-db';
import { FakeProvider } from '@mc-plan/skin-provider-sdk';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';

import {
  createFinalizeWorker,
  createRenderWorker,
  createRetentionQueue,
  createRetentionWorker,
} from './worker-factory.js';
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

const renderWorker = createRenderWorker(ctx, connection);
const finalizeWorker = createFinalizeWorker(ctx, connection);
const retentionWorker = createRetentionWorker(ctx, connection);
const retentionQueue = createRetentionQueue(connection);
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
  queues: ['skin-render', 'skin-finalize', 'skin-retention-cleanup'],
  retry: { attempts: 3, backoff: 'exponential(2000ms)' },
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
