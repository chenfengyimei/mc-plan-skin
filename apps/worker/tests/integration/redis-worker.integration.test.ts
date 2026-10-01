import { Queue } from 'bullmq';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QUEUE_NAMES, type SkeletonPingJob } from '../../src/queues.js';
import { createSkeletonWorker } from '../../src/skeleton-worker.js';

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe('BullMQ worker 与 Redis（testcontainers）', () => {
  let container: StartedRedisContainer;
  let queue: Queue<SkeletonPingJob>;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    const connection = { url: container.getConnectionUrl() };
    queue = new Queue<SkeletonPingJob>(QUEUE_NAMES.skeletonPing, { connection });
  });

  afterAll(async () => {
    await queue?.close();
    await cleanup?.();
    await container?.stop();
  });

  it('入队任务被真实 Redis worker 处理（顺序无关）', async () => {
    const processed: string[] = [];
    const worker = createSkeletonWorker({
      redisUrl: container.getConnectionUrl(),
      onProcessed: (job) => {
        processed.push(job.pingId);
      },
    });
    cleanup = async () => {
      await worker.close();
    };

    const ids = ['ping-a', 'ping-b', 'ping-c'];
    for (const pingId of ids) {
      await queue.add('ping', { pingId, sentAt: new Date().toISOString() });
    }

    const done = await waitFor(async () => processed.length >= ids.length, 30_000);
    expect(done).toBe(true);
    expect(processed.sort()).toEqual([...ids].sort());
  });

  it('非法载荷任务进入 failed 状态而不是无限重试', async () => {
    const processed: string[] = [];
    const worker = createSkeletonWorker({
      redisUrl: container.getConnectionUrl(),
      onProcessed: (job) => {
        processed.push(job.pingId);
      },
    });
    const previousCleanup = cleanup;
    cleanup = async () => {
      await worker.close();
      await previousCleanup?.();
    };

    // 直接以绕过类型的方式注入非法载荷
    await queue.add('ping', { pingId: '', sentAt: 'not-a-date' } as never);

    const failed = await waitFor(async () => (await queue.getFailed()).length >= 1, 30_000);
    expect(failed).toBe(true);
    expect(processed).toHaveLength(0);
  });
});
