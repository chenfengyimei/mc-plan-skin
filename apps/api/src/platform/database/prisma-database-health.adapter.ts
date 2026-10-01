import { Injectable } from '@nestjs/common';

// 必须是值导入：仅类型导入会让 emitDecoratorMetadata 将构造参数退化为 Function，DI 无法解析
import { PrismaService } from './prisma.service.js';
import type { DatabaseHealthCheck, DatabaseHealthPort } from './database-health.port.js';

/** 数据库连接 + 迁移状态就绪检查。失败时 ready 信号为 not_ready。 */
@Injectable()
export class PrismaDatabaseHealthAdapter implements DatabaseHealthPort {
  public constructor(private readonly prisma: PrismaService) {}

  public async check(): Promise<DatabaseHealthCheck> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      return { ok: false, connection: 'down', migrations: 'failed' };
    }
    try {
      const applied = await this.prisma.client.$queryRaw<
        Array<{ migration_name: string }>
      >`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`;
      if (applied.length === 0) {
        return { ok: false, connection: 'up', migrations: 'missing' };
      }
      const failed = await this.prisma.client.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NULL`;
      const failedCount = failed[0]?.count ?? 0n;
      if (failedCount > 0n) {
        return { ok: false, connection: 'up', migrations: 'failed' };
      }
      return { ok: true, connection: 'up', migrations: 'current' };
    } catch {
      return { ok: false, connection: 'up', migrations: 'failed' };
    }
  }
}
