import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import type { ApiConfig } from '@mc-plan/skin-config';
import { QUEUE_NAMES } from '@mc-plan/skin-core';
import { APP_CONFIG } from '../config/config.token.js';

export const RENDER_QUEUE = Symbol('RENDER_QUEUE');
export const FINALIZE_QUEUE = Symbol('FINALIZE_QUEUE');

function createQueue(config: ApiConfig, name: string): Queue {
  return new Queue(name, { connection: { url: config.redisUrl } });
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
  ],
  exports: [RENDER_QUEUE, FINALIZE_QUEUE],
})
export class QueueModule {}
