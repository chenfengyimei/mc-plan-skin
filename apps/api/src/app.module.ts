import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from '@mc-plan/skin-config';
import { ConversationsModule } from './conversations/conversations.module.js';
import { ConfigModule } from './platform/config/config.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthModule } from './platform/health/health.module.js';
import { QueueModule } from './platform/queue/queue.module.js';
import { StorageModule } from './platform/storage/storage.module.js';

@Module({})
export class AppModule {
  public static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        QueueModule,
        StorageModule,
        HealthModule,
        ConversationsModule,
      ],
    };
  }
}
