import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../dist/bootstrap.js';
import { testConfig } from '../helpers/test-config.js';
import { QUEUE_NAMES, FileSystemObjectStorage, sha256Hex } from '@mc-plan/skin-core';
import { createPrismaClient, type PrismaClient } from '@mc-plan/skin-db';
import type { INestApplication } from '@nestjs/common';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 确定性 PNG 魔数字节（预览/下载端点按字节原样返回；解码校验在 worker/e2e 覆盖）。 */
function seededPngBytes(seed: string): Uint8Array {
  const payload = new TextEncoder().encode(`${seed}|anonymous-window`);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...payload]);
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('契约 0.1.0-alpha.1 匿名窗口集成（真实 PostgreSQL + Redis）', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  let db: PrismaClient;
  let storage: FileSystemObjectStorage;
  let storageRoot: string;
  let databaseUrl: string;
  let redisUrl: string;
  let keyCounter = 0;

  const nextKey = (): string => `alpha1-${(keyCounter += 1).toString().padStart(5, '0')}`;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('mc_plan_skin_alpha1_test')
      .withUsername('mc_plan_skin')
      .withPassword('local-test-only')
      .start();
    redis = await new RedisContainer('redis:7-alpine').start();
    databaseUrl = postgres.getConnectionUri();
    redisUrl = redis.getConnectionUrl();
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmExecutable, ['migration:deploy'], {
      cwd: join(packageRoot, '..', '..', 'packages', 'db'),
      env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });
    storageRoot = await mkdtemp(join(tmpdir(), 'skin-alpha1-'));
    storage = new FileSystemObjectStorage(storageRoot);
    db = createPrismaClient(databaseUrl);
    app = await createApplication(
      testConfig({ databaseUrl, redisUrl, candidateStorageRoot: storageRoot }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
    await redis?.stop();
    await postgres?.stop();
  });

  async function apiCreateConversation(message: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/v1/conversations')
      .set('idempotency-key', nextKey())
      .send({ initial_message: message });
    expect(response.status).toBe(201);
    return response.body.conversation_id as string;
  }

  async function apiRequestRender(conversationId: string, message: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/v1/conversations/${conversationId}/renders`)
      .set('idempotency-key', nextKey())
      .send({ message });
    expect(response.status).toBe(202);
    return response.body.job_id as string;
  }

  interface SeededCandidate {
    conversationId: string;
    jobId: string;
    candidateId: string;
    storageKey: string;
    bytes: Uint8Array;
    sha256: string;
  }

  async function seedCandidate(conversationId: string, seed: string): Promise<SeededCandidate> {
    const jobId = await apiRequestRender(conversationId, `${seed} 描述`);
    const bytes = seededPngBytes(seed);
    const storageKey = `candidates/${seed}-candidate.png`;
    await storage.put(storageKey, bytes, 'image/png');
    const candidate = await db.candidate.create({
      data: {
        renderJobId: jobId,
        storageKey,
        sha256: sha256Hex(bytes),
        byteSize: bytes.byteLength,
        mediaType: 'image/png',
        armModel: 'STEVE',
        secondLayer: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return {
      conversationId,
      jobId,
      candidateId: candidate.id,
      storageKey,
      bytes,
      sha256: candidate.sha256,
    };
  }

  interface SeededFinal {
    conversationId: string;
    resourceId: string;
    storageKey: string;
    bytes: Uint8Array;
  }

  async function seedFinalizedSkin(conversationId: string, seed: string): Promise<SeededFinal> {
    const bytes = seededPngBytes(seed);
    const storageKey = `finals/${conversationId}.png`;
    await storage.put(storageKey, bytes, 'image/png');
    const final = await db.finalizedSkin.create({
      data: {
        conversationId,
        storageKey,
        sha256: sha256Hex(bytes),
        byteSize: bytes.byteLength,
        mediaType: 'image/png',
        armModel: 'STEVE',
        secondLayer: true,
        title: `${seed} 成品`,
        description: '',
      },
    });
    return { conversationId, resourceId: final.id, storageKey, bytes };
  }

  it('GET /v1/conversations/{id}：详情含时间顺序消息，仅 user/assistant 公共角色', async () => {
    const conversationId = await apiCreateConversation('雪地探险家');
    await apiRequestRender(conversationId, '加深蓝色围巾');

    // 直接种入一条 SYSTEM 消息，并以显式时间戳保证顺序确定性；公共表面必须过滤 SYSTEM。
    await db.conversationMessage.create({
      data: {
        conversationId,
        role: 'SYSTEM',
        content: '内部系统消息不得出现在公共表面',
        createdAt: new Date('2026-10-08T12:00:01.000Z'),
      },
    });
    const userMessages = await db.conversationMessage.findMany({
      where: { conversationId, role: 'USER' },
      orderBy: { createdAt: 'asc' },
    });
    expect(userMessages).toHaveLength(2);
    await db.conversationMessage.update({
      where: { id: userMessages[0]!.id },
      data: { createdAt: new Date('2026-10-08T12:00:00.000Z') },
    });
    await db.conversationMessage.update({
      where: { id: userMessages[1]!.id },
      data: { createdAt: new Date('2026-10-08T12:00:02.000Z') },
    });

    const response = await request(app.getHttpServer()).get(`/v1/conversations/${conversationId}`);
    expect(response.status).toBe(200);
    expect(response.body.conversation_id).toBe(conversationId);
    expect(response.body.status).toBe('active');
    expect(response.body.attempts_used).toBe(1);
    expect(response.body.attempts_limit).toBe(3);
    expect(typeof response.body.expires_at).toBe('string');
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages[0]).toMatchObject({ role: 'user', content: '雪地探险家' });
    expect(response.body.messages[1]).toMatchObject({ role: 'user', content: '加深蓝色围巾' });
    expect(typeof response.body.messages[0].created_at).toBe('string');
    for (const message of response.body.messages) {
      expect(['user', 'assistant']).toContain(message.role);
    }
  });

  it('GET /v1/conversations/{id}：未知与过期统一 404，不泄露保留细节', async () => {
    const unknown = await request(app.getHttpServer()).get(`/v1/conversations/${UNKNOWN_ID}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('SKIN_CONVERSATION_NOT_FOUND');

    const conversationId = await apiCreateConversation('过期会话');
    await db.conversation.update({
      where: { id: conversationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app.getHttpServer()).get(`/v1/conversations/${conversationId}`);
    expect(expired.status).toBe(404);
    expect(expired.body.code).toBe('SKIN_CONVERSATION_NOT_FOUND');
  });

  it('getCandidatePreview：image/png 字节与 sha 一致；错配/未知/过期/缺对象统一 404', async () => {
    const owner = await apiCreateConversation('候选所有者');
    const other = await apiCreateConversation('另一个会话');
    const seeded = await seedCandidate(owner, 'preview-a');

    const ok = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/candidates/${seeded.candidateId}/preview`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');
    expect(Number(ok.headers['content-length'])).toBe(seeded.bytes.byteLength);
    expect(new Uint8Array(ok.body)).toEqual(seeded.bytes);
    expect(sha256Hex(new Uint8Array(ok.body))).toBe(seeded.sha256);

    const mismatch = await request(app.getHttpServer()).get(
      `/v1/conversations/${other}/candidates/${seeded.candidateId}/preview`,
    );
    expect(mismatch.status).toBe(404);
    expect(mismatch.body.code).toBe('SKIN_CANDIDATE_NOT_FOUND');

    const unknown = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/candidates/${UNKNOWN_ID}/preview`,
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('SKIN_CANDIDATE_NOT_FOUND');

    const expiredSeed = await seedCandidate(owner, 'preview-expired');
    await db.candidate.update({
      where: { id: expiredSeed.candidateId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/candidates/${expiredSeed.candidateId}/preview`,
    );
    expect(expired.status).toBe(404);
    expect(expired.body.code).toBe('SKIN_CANDIDATE_NOT_FOUND');

    const missingObjectSeed = await seedCandidate(owner, 'preview-missing');
    await storage.delete(missingObjectSeed.storageKey);
    const missingObject = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/candidates/${missingObjectSeed.candidateId}/preview`,
    );
    expect(missingObject.status).toBe(404);
    expect(missingObject.body.code).toBe('SKIN_CANDIDATE_NOT_FOUND');

    // 三种 404 的响应形状一致（同 code 同 status），不区分原因、不泄露存储键。
    for (const response of [mismatch, unknown, expired]) {
      expect(response.body.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('candidates/');
    }
  });

  it('downloadSkin：成品字节与 sha 一致；错配/未知/过期会话统一 404', async () => {
    const owner = await apiCreateConversation('成品所有者');
    const other = await apiCreateConversation('无关会话');
    const final = await seedFinalizedSkin(owner, 'final-a');

    const ok = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/skins/${final.resourceId}/download`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');
    expect(new Uint8Array(ok.body)).toEqual(final.bytes);

    const mismatch = await request(app.getHttpServer()).get(
      `/v1/conversations/${other}/skins/${final.resourceId}/download`,
    );
    expect(mismatch.status).toBe(404);
    expect(mismatch.body.code).toBe('SKIN_RESOURCE_NOT_FOUND');

    const unknown = await request(app.getHttpServer()).get(
      `/v1/conversations/${owner}/skins/${UNKNOWN_ID}/download`,
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('SKIN_RESOURCE_NOT_FOUND');

    const expiredOwner = await apiCreateConversation('过期成品会话');
    const expiredFinal = await seedFinalizedSkin(expiredOwner, 'final-expired');
    await db.conversation.update({
      where: { id: expiredOwner },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app.getHttpServer()).get(
      `/v1/conversations/${expiredOwner}/skins/${expiredFinal.resourceId}/download`,
    );
    expect(expired.status).toBe(404);
    expect(expired.body.code).toBe('SKIN_RESOURCE_NOT_FOUND');
  });

  it('Job resource_id：成功 finalize 引用本仓 FinalizedSkin ID；其余为 null', async () => {
    const owner = await apiCreateConversation('资源引用会话');
    const seeded = await seedCandidate(owner, 'resource-final');
    const final = await seedFinalizedSkin(owner, 'resource-final');
    const finalizeJob = await db.renderJob.create({
      data: {
        conversationId: owner,
        attempt: 0,
        kind: 'FINALIZE',
        armModel: 'STEVE',
        prompt: '资源引用成品',
        status: 'SUCCEEDED',
      },
    });
    const succeeded = await request(app.getHttpServer()).get(`/v1/jobs/${finalizeJob.id}`);
    expect(succeeded.status).toBe(200);
    expect(succeeded.body.resource_id).toBe(final.resourceId);
    expect(succeeded.body.candidate_id).toBeNull();

    const renderJob = await request(app.getHttpServer()).get(`/v1/jobs/${seeded.jobId}`);
    expect(renderJob.status).toBe(200);
    expect(renderJob.body.resource_id).toBeNull();

    const failedConversation = await apiCreateConversation('失败确认会话');
    const failedFinalize = await db.renderJob.create({
      data: {
        conversationId: failedConversation,
        attempt: 0,
        kind: 'FINALIZE',
        armModel: 'STEVE',
        prompt: '失败的确认',
        status: 'FAILED',
        errorCode: 'SKIN_VALIDATION_FAILED',
      },
    });
    const failed = await request(app.getHttpServer()).get(`/v1/jobs/${failedFinalize.id}`);
    expect(failed.status).toBe(200);
    expect(failed.body.resource_id).toBeNull();
  });

  it('DELETE /v1/conversations/{id}：204 一次；重复/未知/过期 404', async () => {
    const conversationId = await apiCreateConversation('删除目标');
    const first = await request(app.getHttpServer()).delete(`/v1/conversations/${conversationId}`);
    expect(first.status).toBe(204);
    expect(first.body).toEqual({});

    const repeat = await request(app.getHttpServer()).delete(`/v1/conversations/${conversationId}`);
    expect(repeat.status).toBe(404);
    expect(repeat.body.code).toBe('SKIN_CONVERSATION_NOT_FOUND');

    const unknown = await request(app.getHttpServer()).delete(`/v1/conversations/${UNKNOWN_ID}`);
    expect(unknown.status).toBe(404);

    const expiring = await apiCreateConversation('过期删除目标');
    await db.conversation.update({
      where: { id: expiring },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app.getHttpServer()).delete(`/v1/conversations/${expiring}`);
    expect(expired.status).toBe(404);
    expect(expired.body.code).toBe('SKIN_CONVERSATION_NOT_FOUND');
  });

  it('DELETE 级联：数据库行与对象字节全消失，job/preview/download 均不可访问', async () => {
    const conversationId = await apiCreateConversation('级联删除会话');
    const seeded = await seedCandidate(conversationId, 'cascade');
    const final = await seedFinalizedSkin(conversationId, 'cascade');
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'COMPLETED' },
    });

    const response = await request(app.getHttpServer()).delete(
      `/v1/conversations/${conversationId}`,
    );
    expect(response.status).toBe(204);

    await expect(db.conversation.findUnique({ where: { id: conversationId } })).resolves.toBeNull();
    await expect(
      db.candidate.findUnique({ where: { id: seeded.candidateId } }),
    ).resolves.toBeNull();
    await expect(db.renderJob.findUnique({ where: { id: seeded.jobId } })).resolves.toBeNull();
    await expect(
      db.finalizedSkin.findUnique({ where: { id: final.resourceId } }),
    ).resolves.toBeNull();
    await expect(
      db.conversationMessage.findFirst({ where: { conversationId } }),
    ).resolves.toBeNull();
    await expect(storage.exists(seeded.storageKey)).resolves.toBe(false);
    await expect(storage.exists(final.storageKey)).resolves.toBe(false);

    const job = await request(app.getHttpServer()).get(`/v1/jobs/${seeded.jobId}`);
    expect(job.status).toBe(404);
    expect(job.body.code).toBe('SKIN_JOB_NOT_FOUND');
    const preview = await request(app.getHttpServer()).get(
      `/v1/conversations/${conversationId}/candidates/${seeded.candidateId}/preview`,
    );
    expect(preview.status).toBe(404);
    const download = await request(app.getHttpServer()).get(
      `/v1/conversations/${conversationId}/skins/${final.resourceId}/download`,
    );
    expect(download.status).toBe(404);
    const detail = await request(app.getHttpServer()).get(`/v1/conversations/${conversationId}`);
    expect(detail.status).toBe(404);
  });

  it('对象清理失败：行级删除仍完成，失败键入队保留重试依据', async () => {
    const conversationId = await apiCreateConversation('清理失败会话');
    const seeded = await seedCandidate(conversationId, 'cleanup-retry');
    const final = await seedFinalizedSkin(conversationId, 'cleanup-retry');

    // 对象真实父目录（candidates/、finals/）置为只读，使同步对象删除失败（数据库行删除不受影响）。
    const candidatesDir = join(storageRoot, 'candidates');
    const finalsDir = join(storageRoot, 'finals');
    await chmod(candidatesDir, 0o500);
    await chmod(finalsDir, 0o500);
    try {
      const response = await request(app.getHttpServer()).delete(
        `/v1/conversations/${conversationId}`,
      );
      expect(response.status).toBe(204);
    } finally {
      await chmod(candidatesDir, 0o700);
      await chmod(finalsDir, 0o700);
    }

    await expect(db.conversation.findUnique({ where: { id: conversationId } })).resolves.toBeNull();
    await expect(storage.exists(seeded.storageKey)).resolves.toBe(true);

    const queue = new Queue(QUEUE_NAMES.retentionCleanup, { connection: { url: redisUrl } });
    try {
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'failed'], 0, 50);
      const retryJob = jobs.find((job) => job.id === `object-cleanup-${conversationId}`);
      expect(retryJob).toBeDefined();
      const keys = (retryJob?.data as { keys: string[] }).keys;
      expect(keys).toContain(seeded.storageKey);
      expect(keys).toContain(final.storageKey);
    } finally {
      await queue.close();
    }
  });
});
