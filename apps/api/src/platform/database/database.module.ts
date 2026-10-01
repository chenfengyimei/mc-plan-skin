import { Global, Module } from '@nestjs/common';

import { DATABASE_HEALTH } from './database-health.port.js';
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
  ],
  exports: [PrismaService, DATABASE_HEALTH],
})
export class DatabaseModule {}
