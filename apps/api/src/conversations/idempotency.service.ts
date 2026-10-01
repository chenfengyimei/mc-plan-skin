import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PRISMA_CLIENT, type PrismaClient } from '../platform/database/prisma.token.js';

export const IDEMPOTENCY_CONFLICT = 'SKIN_IDEMPOTENCY_CONFLICT';

/**
 * 幂等键语义（standard：api.md）：
 * - 同键同请求体 → 重放原始响应，不重复产生副作用；
 * - 同键不同请求体 → 409 冲突。
 * 键本身不包含敏感值；指纹只保存哈希。
 */
@Injectable()
export class IdempotencyService {
  public constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  public fingerprint(body: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(body ?? null))
      .digest('hex');
  }

  public async find<TResponse>(
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<TResponse | { conflict: true } | undefined> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { operation_key: { operation, key } },
    });
    if (!record) {
      return undefined;
    }
    if (record.fingerprint !== fingerprint) {
      return { conflict: true };
    }
    return record.response as TResponse;
  }

  public async store<TResponse>(
    operation: string,
    key: string,
    fingerprint: string,
    response: TResponse,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.create({
      data: { operation, key, fingerprint, response: response as object },
    });
  }
}
