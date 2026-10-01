import type { Logger } from 'pino';
import type { Clock, ObjectStorage } from '@mc-plan/skin-core';
import type { PrismaClient } from '@mc-plan/skin-db';
import type { ProviderAdapter } from '@mc-plan/skin-provider-sdk';

/** worker 处理器共享依赖：数据库、隔离存储、提供商适配器、可控时钟与日志。 */
export interface WorkerContext {
  db: PrismaClient;
  storage: ObjectStorage;
  provider: ProviderAdapter;
  clock: Clock;
  logger: Logger;
  candidateRetentionHours: number;
}
