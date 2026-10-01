import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FixedClock, candidateStorageKey } from '@mc-plan/skin-core';
import { createPrismaClient, type PrismaClient } from '@mc-plan/skin-db';
import { FakeProvider } from '@mc-plan/skin-provider-sdk';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';
import { FileSystemObjectStorage } from '@mc-plan/skin-core';

import { processFinalizeJob } from '../../src/finalize.processor.js';
import { processRenderJob } from '../../src/render.processor.js';
import { runRetentionCleanup } from '../../src/retention.processor.js';
import type { WorkerContext } from '../../src/worker-context.js';
import type { Job } from 'bullmq';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fakeBullJob = { attemptsMade: 0 } as unknown as Job;

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
    await processRenderJob(
      badProviderCtx,
      {
        jobId: job.id,
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'steve',
        prompt: '坏结果',
      },
      fakeBullJob,
    );

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
});
