import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import type { ApiConfig } from '@mc-plan/skin-config';
import { APP_CONFIG } from '../config/config.token.js';

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  public readonly client: PrismaClient;

  public constructor(@Inject(APP_CONFIG) config: ApiConfig) {
    const adapter = new PrismaPg({ connectionString: config.databaseUrl });
    this.client = new PrismaClient({ adapter });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
