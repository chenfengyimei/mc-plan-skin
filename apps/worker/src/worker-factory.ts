import { Queue, Worker, type WorkerOptions } from 'bullmq';

import {
  QUEUE_NAMES,
  SKIN_RETRYABLE_JOB_OPTIONS,
  type FinalizeJobPayload,
  type RenderJobPayload,
} from '@mc-plan/skin-core';

import { processFinalizeJob } from './finalize.processor.js';
import { parseObjectCleanupPayload } from './payloads.js';
import { processRenderJob } from './render.processor.js';
import { runObjectCleanup, runRetentionCleanup } from './retention.processor.js';
import type { WorkerContext } from './worker-context.js';

export { SKIN_RETRYABLE_JOB_OPTIONS as RETRYABLE_JOB_OPTIONS } from '@mc-plan/skin-core';

/**
 * worker 创建工厂（主程序与测试共用同一实现）。
 * 重试策略由队列/入队侧的 SKIN_RETRYABLE_JOB_OPTIONS 决定，
 * 可重试提供商错误经指数退避重试耗尽后由处理器写入最终错误码。
 */
export function createRenderWorker(
  ctx: WorkerContext,
  connection: WorkerOptions['connection'],
): Worker<RenderJobPayload> {
  return new Worker<RenderJobPayload>(
    QUEUE_NAMES.render,
    (job) => processRenderJob(ctx, job.data, job),
    { connection, concurrency: 2 },
  );
}

export function createFinalizeWorker(
  ctx: WorkerContext,
  connection: WorkerOptions['connection'],
): Worker<FinalizeJobPayload> {
  return new Worker<FinalizeJobPayload>(
    QUEUE_NAMES.finalize,
    (job) => processFinalizeJob(ctx, job.data),
    { connection, concurrency: 2 },
  );
}

export function createRetentionWorker(
  ctx: WorkerContext,
  connection: WorkerOptions['connection'],
): Worker {
  return new Worker(
    QUEUE_NAMES.retentionCleanup,
    async (job) => {
      // 载荷区分两种任务：keys=会话级删除的对象清理重试；空载荷=每小时保留清扫。
      const data = job.data as Record<string, unknown> | null;
      if (data && Array.isArray(data.keys)) {
        await runObjectCleanup(ctx, parseObjectCleanupPayload(data).keys);
        return;
      }
      await runRetentionCleanup(ctx);
    },
    { connection, concurrency: 1 },
  );
}

export function createRetentionQueue(connection: WorkerOptions['connection']): Queue {
  return new Queue(QUEUE_NAMES.retentionCleanup, {
    connection,
    defaultJobOptions: SKIN_RETRYABLE_JOB_OPTIONS,
  });
}
