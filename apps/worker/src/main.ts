import 'dotenv/config';
import pino from 'pino';

import { loadWorkerConfig } from '@mc-plan/skin-config';
import { createSkeletonWorker } from './skeleton-worker.js';

const config = loadWorkerConfig(process.env);
const logger = pino({
  level: config.logLevel,
  base: { service: 'skin-worker', environment: config.env, run_mode: config.runMode },
  redact: {
    paths: ['SKIN_DATABASE_URL', 'SKIN_REDIS_URL', 'password'],
    censor: '[REDACTED]',
  },
  messageKey: 'event',
});

logger.info({
  event: 'worker_starting',
  result: 'success',
  queues: ['skin-skeleton-ping'],
  retention: {
    conversation_days: config.conversationRetentionDays,
    candidate_hours: config.candidateRetentionHours,
  },
});

const worker = createSkeletonWorker({ redisUrl: config.redisUrl, logger });

const shutdown = async (): Promise<void> => {
  logger.info({ event: 'worker_stopping', result: 'success' });
  await worker.close();
};

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
