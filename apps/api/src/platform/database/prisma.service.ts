import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { createPrismaClient, type PrismaClient } from '@mc-plan/skin-db';
import type { ApiConfig } from '@mc-plan/skin-config';
import { APP_CONFIG } from '../config/config.token.js';

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  public readonly client: PrismaClient;

  public constructor(@Inject(APP_CONFIG) config: ApiConfig) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
