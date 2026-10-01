import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';

import { DATABASE_HEALTH, type DatabaseHealthPort } from '../database/database-health.port.js';

/**
 * 私有健康探针（standards/observability.md）：
 * - liveness 不探测任何依赖；
 * - readiness 只探测当前功能真正必需的数据库连接与迁移状态。
 */
@Controller('health')
export class HealthController {
  public constructor(@Inject(DATABASE_HEALTH) private readonly database: DatabaseHealthPort) {}

  @Get('live')
  public liveness(): { status: 'up' } {
    return { status: 'up' };
  }

  @Get('ready')
  public async readiness(@Res({ passthrough: true }) response: ExpressResponse): Promise<{
    status: 'ready' | 'not_ready';
    checks: { database: 'up' | 'down'; migrations: 'current' | 'missing' | 'failed' };
  }> {
    const database = await this.database.check();
    response.status(database.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database.ok ? 'ready' : 'not_ready',
      checks: {
        database: database.connection,
        migrations: database.migrations,
      },
    };
  }
}
