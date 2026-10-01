import type { Logger } from 'pino';
import { Worker, type Job } from 'bullmq';

import { QUEUE_NAMES, type SkeletonPingJob } from './queues.js';
import { parseSkeletonPingJob } from './skeleton-ping.js';

export interface SkeletonWorkerOptions {
  redisUrl: string;
  logger?: Logger;
  onProcessed?: (job: SkeletonPingJob) => void;
}

/** 创建骨架 ping worker。真实渲染/清理处理器在后续工作流中接入同一执行机制。 */
export function createSkeletonWorker(options: SkeletonWorkerOptions): Worker<SkeletonPingJob> {
  const worker = new Worker<SkeletonPingJob>(
    QUEUE_NAMES.skeletonPing,
    async (job: Job<SkeletonPingJob>) => {
      const payload = parseSkeletonPingJob(job.data);
      options.onProcessed?.(payload);
      options.logger?.info({
        event: 'skeleton_ping_processed',
        result: 'success',
        ping_id: payload.pingId,
      });
    },
    { connection: { url: options.redisUrl }, concurrency: 2 },
  );
  worker.on('failed', (job, error) => {
    options.logger?.error({
      event: 'skeleton_ping_failed',
      result: 'failure',
      job_id: job?.id ?? 'unknown',
      error: error.name,
    });
  });
  return worker;
}
