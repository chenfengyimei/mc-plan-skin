import { Global, Module } from '@nestjs/common';

import { DATABASE_HEALTH } from './database-health.port.js';
import { PRISMA_CLIENT } from './prisma.token.js';
import { PrismaDatabaseHealthAdapter } from './prisma-database-health.adapter.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaDatabaseHealthAdapter,
    {
      provide: DATABASE_HEALTH,
      useExisting: PrismaDatabaseHealthAdapter,
    },
    {
      provide: PRISMA_CLIENT,
      useFactory: (service: PrismaService) => service.client,
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService, DATABASE_HEALTH, PRISMA_CLIENT],
})
export class DatabaseModule {}
