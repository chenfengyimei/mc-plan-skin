import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FixedClock, QUEUE_NAMES, candidateStorageKey } from '@mc-plan/skin-core';
import { createPrismaClient, type PrismaClient } from '@mc-plan/skin-db';
import {
  FakeProvider,
  FixedImageClient,
  FixedVisionClient,
  ImageConceptSkinProvider,
  LlmStructuredSkinProvider,
  type ProviderAdapter,
} from '@mc-plan/skin-provider-sdk';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';
import { FileSystemObjectStorage } from '@mc-plan/skin-core';

import { processFinalizeJob } from '../../src/finalize.processor.js';
import { processRenderJob } from '../../src/render.processor.js';
import { runObjectCleanup, runRetentionCleanup } from '../../src/retention.processor.js';
import type { WorkerContext } from '../../src/worker-context.js';
import {
  RETRYABLE_JOB_OPTIONS,
  createRenderWorker,
  createRetentionWorker,
} from '../../src/worker-factory.js';
import type { Job } from 'bullmq';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fakeBullJob = { attemptsMade: 0 } as unknown as Job;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

describe('渲染→候选→确认→保留 纵向链路（真实 PostgreSQL）', () => {
  let container: StartedPostgreSqlContainer;
  let db: PrismaClient;
  let storageRoot: string;
  let ctx: WorkerContext;
  let clock: FixedClock;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('mc_plan_skin_worker_test')
      .withUsername('mc_plan_skin')
      .withPassword('local-test-only')
      .start();
    const databaseUrl = container.getConnectionUri();
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmExecutable, ['migration:deploy'], {
      cwd: join(packageRoot, '..', '..', 'packages', 'db'),
      env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });

    db = createPrismaClient(databaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'skin-worker-'));
    clock = new FixedClock(new Date('2026-10-01T12:00:00Z'));
    ctx = {
      db,
      storage: new FileSystemObjectStorage(storageRoot),
      provider: new FakeProvider({
        environment: 'test',
        resolveFixture: async (request) =>
          loadFixtureBytes(request.armModel === 'alex' ? 'valid-alex' : 'valid-steve'),
      }),
      clock,
      logger: pino({ level: 'fatal' }),
      candidateRetentionHours: 24,
    };
  });

  afterAll(async () => {
    await db?.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
    await container?.stop();
  });

  async function seedConversation() {
    return db.conversation.create({
      data: {
        attemptsLimit: 3,
        expiresAt: new Date(clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
        messages: { create: { role: 'USER', content: '雪地探险家' } },
      },
    });
  }

  it('渲染处理器：Fake Provider 候选入库、隔离存储、24 小时过期', async () => {
    const conversation = await seedConversation();
    const job = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '雪地探险家',
      },
    });

    await processRenderJob(
      ctx,
      {
        jobId: job.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '雪地探险家',
      },
      fakeBullJob,
    );

    const updated = await db.renderJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { candidate: true },
    });
    expect(updated.status).toBe('SUCCEEDED');
    expect(updated.providerCallId).toMatch(/^fake-/);
    const candidate = updated.candidate;
    expect(candidate).not.toBeNull();
    expect(candidate?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate?.byteSize).toBeGreaterThan(0);
    expect(candidate?.mediaType).toBe('image/png');
    expect(candidate?.secondLayer).toBe(true);
    // 24 小时过期（可控时钟）
    expect(candidate?.expiresAt.getTime()).toBe(clock.now().getTime() + 24 * 60 * 60 * 1000);
    // 隔离对象真实存在且键不可预测
    expect(candidate?.storageKey).toBe(candidateStorageKey(candidate!.id));
    await expect(ctx.storage.exists(candidate!.storageKey)).resolves.toBe(true);
  });

  it('渲染处理器：候选字节校验失败时任务标记 SKIN_VALIDATION_FAILED', async () => {
    const conversation = await seedConversation();
    const job = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '坏结果',
      },
    });

    const badProviderCtx: WorkerContext = {
      ...ctx,
      provider: new FakeProvider({
        environment: 'test',
        resolveFixture: async () => new TextEncoder().encode('not a png'),
      }),
    };
    await expect(
      processRenderJob(
        badProviderCtx,
        {
          jobId: job.id,
          conversationId: conversation.id,
          attempt: 1,
          armModel: 'steve',
          prompt: '坏结果',
        },
        fakeBullJob,
      ),
    ).rejects.toThrow('SKIN_VALIDATION_FAILED');

    const updated = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe('FAILED');
    expect(updated.errorCode).toBe('SKIN_VALIDATION_FAILED');
  });

  it('确认处理器：重校验、成品存储、FinalizedSkin 与会话完成', async () => {
    const conversation = await seedConversation();
    const renderJob = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '森林游侠',
      },
    });
    await processRenderJob(
      ctx,
      {
        jobId: renderJob.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '森林游侠',
      },
      fakeBullJob,
    );
    const candidate = await db.candidate.findUniqueOrThrow({
      where: { renderJobId: renderJob.id },
    });

    await db.conversation.update({
      where: { id: conversation.id },
      data: { status: 'FINALIZING' },
    });
    const finalizeJob = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 0,
        kind: 'FINALIZE',
        armModel: 'STEVE',
        prompt: '森林游侠成品',
      },
    });

    await processFinalizeJob(ctx, {
      jobId: finalizeJob.id,
      conversationId: conversation.id,
      candidateId: candidate.id,
      title: '森林游侠',
      description: '戴兜帽的游侠',
    });

    const completed = await db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { finalizedSkin: true },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.finalizedSkin?.sha256).toBe(candidate.sha256);
    expect(completed.finalizedSkin?.title).toBe('森林游侠');
    expect(completed.finalizedSkin?.storageKey).toBe(`finals/${conversation.id}.png`);
    await expect(ctx.storage.exists(`finals/${conversation.id}.png`)).resolves.toBe(true);
  });

  it('保留清理：过期候选与会话被删除，未过期保留', async () => {
    // 未过期候选（刚创建的会话）
    const kept = await seedConversation();
    const keptJob = await db.renderJob.create({
      data: {
        conversationId: kept.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '保留',
      },
    });
    await processRenderJob(
      ctx,
      { jobId: keptJob.id, conversationId: kept.id, attempt: 1, armModel: 'steve', prompt: '保留' },
      fakeBullJob,
    );

    // 过期候选：直接将 expiresAt 置于过去
    const stale = await seedConversation();
    const staleJob = await db.renderJob.create({
      data: {
        conversationId: stale.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '过期',
      },
    });
    await processRenderJob(
      ctx,
      {
        jobId: staleJob.id,
        conversationId: stale.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '过期',
      },
      fakeBullJob,
    );
    const staleCandidate = await db.candidate.findUniqueOrThrow({
      where: { renderJobId: staleJob.id },
    });
    const staleKey = staleCandidate.storageKey;
    expect(await ctx.storage.exists(staleKey)).toBe(true);
    await db.candidate.update({
      where: { id: staleCandidate.id },
      data: { expiresAt: new Date(clock.now().getTime() - 1000) },
    });

    // 过期会话
    const expiredConversation = await db.conversation.create({
      data: {
        attemptsLimit: 3,
        expiresAt: new Date(clock.now().getTime() - 1000),
      },
    });

    const report = await runRetentionCleanup(ctx);
    expect(report.deletedCandidates).toBe(1);
    expect(report.deletedConversations).toBe(1);
    expect(report.failedObjectDeletes).toBe(0);

    await expect(db.candidate.findUnique({ where: { id: staleCandidate.id } })).resolves.toBeNull();
    await expect(ctx.storage.exists(staleKey)).resolves.toBe(false);
    await expect(
      db.conversation.findUnique({ where: { id: expiredConversation.id } }),
    ).resolves.toBeNull();
    const keptAfter = await db.conversation.findUniqueOrThrow({ where: { id: kept.id } });
    expect(keptAfter.status).toBe('ACTIVE');
  });

  it('runObjectCleanup：删除指定键；缺失键幂等；失败抛出交由重试', async () => {
    const keyA = 'candidates/cleanup-a.png';
    const keyB = 'candidates/cleanup-b.png';
    await ctx.storage.put(keyA, new Uint8Array([1, 2]), 'image/png');
    await ctx.storage.put(keyB, new Uint8Array([3, 4]), 'image/png');

    await runObjectCleanup(ctx, [keyA, keyB]);
    await expect(ctx.storage.exists(keyA)).resolves.toBe(false);
    await expect(ctx.storage.exists(keyB)).resolves.toBe(false);

    // 已被删除的键再次清理保持幂等（不抛出）。
    await expect(runObjectCleanup(ctx, [keyA])).resolves.toBeUndefined();

    const failingCtx: WorkerContext = {
      ...ctx,
      storage: {
        ...ctx.storage,
        delete: async () => {
          throw new Error('storage down');
        },
      },
    };
    await expect(runObjectCleanup(failingCtx, [keyB])).rejects.toThrow('storage down');
  });

  it('会话删除后：在途渲染任务无法写回候选（行级联缺失）', async () => {
    const conversation = await seedConversation();
    const job = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '删除后渲染',
      },
    });
    await db.conversation.delete({ where: { id: conversation.id } });

    await expect(
      processRenderJob(
        ctx,
        {
          jobId: job.id,
          conversationId: conversation.id,
          attempt: 1,
          armModel: 'steve',
          prompt: '删除后渲染',
        },
        fakeBullJob,
      ),
    ).rejects.toThrow('render job row missing');

    const remaining = await db.candidate.findMany({
      where: { renderJob: { conversationId: conversation.id } },
    });
    expect(remaining).toHaveLength(0);
  });

  it('会话删除后：在途确认任务无法写回成品（行级联缺失）', async () => {
    const conversation = await seedConversation();
    const renderJob = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '删除后确认',
      },
    });
    await processRenderJob(
      ctx,
      {
        jobId: renderJob.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '删除后确认',
      },
      fakeBullJob,
    );
    const candidate = await db.candidate.findUniqueOrThrow({
      where: { renderJobId: renderJob.id },
    });
    const finalizeJob = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 0,
        kind: 'FINALIZE',
        armModel: 'STEVE',
        prompt: '删除后确认成品',
      },
    });

    await db.conversation.delete({ where: { id: conversation.id } });

    await expect(
      processFinalizeJob(ctx, {
        jobId: finalizeJob.id,
        conversationId: conversation.id,
        candidateId: candidate.id,
        title: '不可复活',
        description: '',
      }),
    ).rejects.toThrow('finalize job row missing');

    const finals = await db.finalizedSkin.findMany({
      where: { conversationId: conversation.id },
    });
    expect(finals).toHaveLength(0);
  });

  describe('Provider 适配器业务链路一致性（fake/llm/image 同链）', () => {
    const fixturesRoot = join(packageRoot, '..', '..', 'packages', 'test-fixtures', 'assets');

    function providerCases(): Array<{ name: string; adapter: ProviderAdapter; callId: RegExp }> {
      return [
        {
          name: 'fake',
          adapter: new FakeProvider({
            environment: 'test',
            resolveFixture: async (request) =>
              loadFixtureBytes(request.armModel === 'alex' ? 'valid-alex' : 'valid-steve'),
          }),
          callId: /^fake-/,
        },
        {
          name: 'llm',
          adapter: new LlmStructuredSkinProvider({
            environment: 'test',
            client: {
              complete: async () => ({
                content: await readFile(join(fixturesRoot, 'concept-blueprint.json'), 'utf8'),
                providerCallId: 'parity-llm',
                inputUnits: 100,
                outputUnits: 50,
              }),
            },
          }),
          callId: /^llm-/,
        },
        {
          name: 'image',
          adapter: new ImageConceptSkinProvider({
            environment: 'test',
            imageClient: new FixedImageClient({ path: join(fixturesRoot, 'concept-explorer.png') }),
            visionClient: new FixedVisionClient({
              path: join(fixturesRoot, 'concept-blueprint.json'),
            }),
          }),
          callId: /^img-/,
        },
      ];
    }

    for (const { name, adapter, callId } of providerCases()) {
      it(`${name}：渲染→候选校验入库→确认成品 全链行为一致（真实 PostgreSQL）`, async () => {
        const conversation = await seedConversation();
        const job = await db.renderJob.create({
          data: {
            conversationId: conversation.id,
            attempt: 1,
            kind: 'RENDER',
            armModel: 'STEVE',
            prompt: '雪地探险家',
          },
        });

        await processRenderJob(
          { ...ctx, provider: adapter },
          {
            jobId: job.id,
            conversationId: conversation.id,
            attempt: 1,
            armModel: 'steve',
            prompt: '雪地探险家',
          },
          fakeBullJob,
        );

        const rendered = await db.renderJob.findUniqueOrThrow({
          where: { id: job.id },
          include: { candidate: true },
        });
        expect(rendered.status).toBe('SUCCEEDED');
        expect(rendered.providerCallId).toMatch(callId);
        const candidate = rendered.candidate;
        expect(candidate).not.toBeNull();
        expect(candidate?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(candidate?.mediaType).toBe('image/png');
        expect(candidate?.secondLayer).toBe(true);
        await expect(ctx.storage.exists(candidate!.storageKey)).resolves.toBe(true);

        // 确认成品：同一业务链路语义（COMPLETED + final 字节与候选一致）
        await db.conversation.update({
          where: { id: conversation.id },
          data: { status: 'FINALIZING' },
        });
        const finalizeJob = await db.renderJob.create({
          data: {
            conversationId: conversation.id,
            attempt: 0,
            kind: 'FINALIZE',
            armModel: 'STEVE',
            prompt: `${name} 链路一致性`,
          },
        });
        await processFinalizeJob(
          { ...ctx, provider: adapter },
          {
            jobId: finalizeJob.id,
            conversationId: conversation.id,
            candidateId: candidate!.id,
            title: `${name} parity`,
            description: `${name} 链路一致性`,
          },
        );
        const completed = await db.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
          include: { finalizedSkin: true },
        });
        expect(completed.status).toBe('COMPLETED');
        expect(completed.finalizedSkin?.sha256).toBe(candidate!.sha256);
        expect(completed.finalizedSkin?.storageKey).toBe(`finals/${conversation.id}.png`);
        await expect(ctx.storage.exists(`finals/${conversation.id}.png`)).resolves.toBe(true);
      });
    }
  });
});

describe('BullMQ 重试语义（真实 Redis + PostgreSQL）', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let db: PrismaClient;
  let storageRoot: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('mc_plan_skin_retry_test')
      .withUsername('mc_plan_skin')
      .withPassword('local-test-only')
      .start();
    redis = await new RedisContainer('redis:7-alpine').start();
    const databaseUrl = postgres.getConnectionUri();
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmExecutable, ['migration:deploy'], {
      cwd: join(packageRoot, '..', '..', 'packages', 'db'),
      env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });
    db = createPrismaClient(databaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'skin-retry-'));
  });

  afterAll(async () => {
    await db?.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
    await redis?.stop();
    await postgres?.stop();
  });

  it('可重试提供商错误经三次尝试后进入 failed，任务行标记最终错误码', async () => {
    const conversation = await db.conversation.create({
      data: {
        attemptsLimit: 3,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        messages: { create: { role: 'USER', content: '重试测试' } },
      },
    });
    const job = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '重试测试',
      },
    });

    // 始终返回可重试限流错误的提供商桩
    let attempts = 0;
    const flakyCtx: WorkerContext = {
      db,
      storage: new FileSystemObjectStorage(storageRoot),
      provider: {
        name: 'flaky-test',
        async generate() {
          attempts += 1;
          return {
            status: 'failed' as const,
            errorCode: 'PROVIDER_RATE_LIMITED' as const,
            message: '模拟限流',
          };
        },
      },
      clock: new FixedClock(new Date()),
      logger: pino({ level: 'fatal' }),
      candidateRetentionHours: 24,
    };

    const connection = { url: redis.getConnectionUrl() };
    const worker = createRenderWorker(flakyCtx, connection);
    const queue = new Queue(QUEUE_NAMES.render, { connection });
    await queue.add(
      QUEUE_NAMES.render,
      {
        jobId: job.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '重试测试',
      },
      { jobId: job.id, ...RETRYABLE_JOB_OPTIONS },
    );

    // 等待任务进入 failed（3 次尝试 + 指数退避 ≈ 6 秒）
    const failed = await waitFor(
      async () => (await queue.getFailed()).some((entry) => entry.id === job.id),
      60_000,
    );
    expect(failed).toBe(true);

    const failedJobs = await queue.getFailed();
    const failedJob = failedJobs.find((entry) => entry.id === job.id);
    expect(failedJob?.attemptsMade).toBe(RETRYABLE_JOB_OPTIONS.attempts);
    expect(attempts).toBe(RETRYABLE_JOB_OPTIONS.attempts);

    const row = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('PROVIDER_RATE_LIMITED');

    await worker.close();
    await queue.close();
  });

  it('保留 worker：keys 载荷执行目标清理，空载荷执行清扫', async () => {
    const storage = new FileSystemObjectStorage(storageRoot);
    const targetedKey = 'candidates/targeted-cleanup.png';
    await storage.put(targetedKey, new Uint8Array([9, 9]), 'image/png');

    const clock = new FixedClock(new Date());
    const retentionCtx: WorkerContext = {
      db,
      storage,
      provider: new FakeProvider({
        environment: 'test',
        resolveFixture: async () => loadFixtureBytes('valid-steve'),
      }),
      clock,
      logger: pino({ level: 'fatal' }),
      candidateRetentionHours: 24,
    };
    const conversation = await db.conversation.create({
      data: {
        attemptsLimit: 3,
        expiresAt: new Date(clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const staleJob = await db.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        kind: 'RENDER',
        armModel: 'STEVE',
        prompt: '过期清理',
      },
    });
    await processRenderJob(
      retentionCtx,
      {
        jobId: staleJob.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '过期清理',
      },
      fakeBullJob,
    );
    const staleCandidate = await db.candidate.findUniqueOrThrow({
      where: { renderJobId: staleJob.id },
    });
    await db.candidate.update({
      where: { id: staleCandidate.id },
      data: { expiresAt: new Date(clock.now().getTime() - 1000) },
    });

    const connection = { url: redis.getConnectionUrl() };
    const worker = createRetentionWorker(retentionCtx, connection);
    const queue = new Queue(QUEUE_NAMES.retentionCleanup, {
      connection,
      defaultJobOptions: RETRYABLE_JOB_OPTIONS,
    });
    try {
      await queue.add(
        QUEUE_NAMES.retentionCleanup,
        { keys: [targetedKey] },
        { jobId: 'targeted-cleanup-test' },
      );
      const targetedDone = await waitFor(async () => !(await storage.exists(targetedKey)), 30_000);
      expect(targetedDone).toBe(true);
      // 目标清理不触发清扫：过期候选行仍在。
      await expect(
        db.candidate.findUnique({ where: { id: staleCandidate.id } }),
      ).resolves.not.toBeNull();

      await queue.add(QUEUE_NAMES.retentionCleanup, {}, { jobId: 'sweep-cleanup-test' });
      const swept = await waitFor(
        async () => (await db.candidate.findUnique({ where: { id: staleCandidate.id } })) === null,
        30_000,
      );
      expect(swept).toBe(true);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
