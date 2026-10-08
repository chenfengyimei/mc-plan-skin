import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import type { ApiConfig } from '@mc-plan/skin-config';
import { QUEUE_NAMES, SKIN_RETRYABLE_JOB_OPTIONS } from '@mc-plan/skin-core';
import { APP_CONFIG } from '../config/config.token.js';

export const RENDER_QUEUE = Symbol('RENDER_QUEUE');
export const FINALIZE_QUEUE = Symbol('FINALIZE_QUEUE');
export const RETENTION_QUEUE = Symbol('RETENTION_QUEUE');

/** 队列携带失败重试语义（指数退避 3 次尝试），与 worker 处理器约定一致。 */
function createQueue(config: ApiConfig, name: string): Queue {
  return new Queue(name, {
    connection: { url: config.redisUrl },
    defaultJobOptions: SKIN_RETRYABLE_JOB_OPTIONS,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: RENDER_QUEUE,
      useFactory: (config: ApiConfig) => createQueue(config, QUEUE_NAMES.render),
      inject: [APP_CONFIG],
    },
    {
      provide: FINALIZE_QUEUE,
      useFactory: (config: ApiConfig) => createQueue(config, QUEUE_NAMES.finalize),
      inject: [APP_CONFIG],
    },
    {
      provide: RETENTION_QUEUE,
      useFactory: (config: ApiConfig) => createQueue(config, QUEUE_NAMES.retentionCleanup),
      inject: [APP_CONFIG],
    },
  ],
  exports: [RENDER_QUEUE, FINALIZE_QUEUE, RETENTION_QUEUE],
})
export class QueueModule {}
