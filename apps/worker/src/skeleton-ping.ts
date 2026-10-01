import { z } from 'zod';

import type { SkeletonPingJob } from './queues.js';

const skeletonPingSchema = z.object({
  pingId: z.string().min(1).max(64),
  sentAt: z.iso.datetime(),
});

/** 任务载荷必须在执行前校验；非法载荷进入可处理的失败状态而不是静默丢弃。 */
export function parseSkeletonPingJob(input: unknown): SkeletonPingJob {
  return skeletonPingSchema.parse(input);
}
