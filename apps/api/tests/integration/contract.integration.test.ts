import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../dist/bootstrap.js';
import { testConfig } from '../helpers/test-config.js';
import type { INestApplication } from '@nestjs/common';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('契约操作集成（真实 PostgreSQL + Redis）', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('mc_plan_skin_api_test')
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

    app = await createApplication(
      testConfig({
        databaseUrl,
        redisUrl: redis.getConnectionUrl(),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await redis?.stop();
    await postgres?.stop();
  });

  async function idempotentPost(
    path: string,
    body: unknown,
    key: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(path)
      .set('idempotency-key', key)
      .send(body as object);
  }

  it('POST /v1/conversations 201 返回契约 Conversation 形状', async () => {
    const response = await idempotentPost(
      '/v1/conversations',
      { initial_message: '雪地探险家' },
      'key-create-0001',
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'active',
      attempts_used: 0,
      attempts_limit: 3,
    });
    expect(typeof response.body.conversation_id).toBe('string');
    expect(typeof response.body.expires_at).toBe('string');
  });

  it('缺少 Idempotency-Key 时返回 400 problem+json', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/conversations')
      .send({ initial_message: 'x' });
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('SKIN_BAD_REQUEST');
  });

  it('幂等重放返回原结果，同键不同体返回 409', async () => {
    const first = await idempotentPost(
      '/v1/conversations',
      { initial_message: '海盗船长' },
      'key-replay-0001',
    );
    const replay = await idempotentPost(
      '/v1/conversations',
      { initial_message: '海盗船长' },
      'key-replay-0001',
    );
    expect(replay.status).toBe(201);
    expect(replay.body.conversation_id).toBe(first.body.conversation_id);

    const conflict = await idempotentPost(
      '/v1/conversations',
      { initial_message: '不同的描述' },
      'key-replay-0001',
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('SKIN_IDEMPOTENCY_CONFLICT');
  });

  it('渲染请求：202 契约形状、三次上限 409、并发不超限', async () => {
    const created = await idempotentPost(
      '/v1/conversations',
      { initial_message: '熔岩骑士' },
      'key-render-0001',
    );
    const conversationId = created.body.conversation_id;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await idempotentPost(
        `/v1/conversations/${conversationId}/renders`,
        { message: `第 ${attempt} 版`, preferred_arm_model: 'alex' },
        `key-render-${attempt.toString().padStart(2, '0')}`,
      );
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ status: 'queued' });
      expect(typeof response.body.job_id).toBe('string');
    }

    const exhausted = await idempotentPost(
      `/v1/conversations/${conversationId}/renders`,
      { message: '第四次' },
      'key-render-04',
    );
    expect(exhausted.status).toBe(409);
    expect(exhausted.body.code).toBe('SKIN_ATTEMPTS_EXHAUSTED');

    // 并发：新会话同时发起 5 个渲染，恰好 3 个 202
    const concurrent = await idempotentPost(
      '/v1/conversations',
      { initial_message: '并发测试' },
      'key-conc-00001',
    );
    const concurrentId: string = concurrent.body.conversation_id;
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        idempotentPost(
          `/v1/conversations/${concurrentId}/renders`,
          { message: `并发 ${index}` },
          `key-conc-${index.toString().padStart(2, '0')}`,
        ),
      ),
    );
    const accepted = responses.filter((response) => response.status === 202);
    const rejected = responses.filter((response) => response.status === 409);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);
  });

  it('GET /v1/jobs/{id} 返回契约 Job 形状；未知任务与未知会话 404', async () => {
    const created = await idempotentPost(
      '/v1/conversations',
      { initial_message: '森林游侠' },
      'key-jobs-00001',
    );
    const conversationId: string = created.body.conversation_id;
    const render = await idempotentPost(
      `/v1/conversations/${conversationId}/renders`,
      { message: '戴兜帽的游侠' },
      'key-jobs-00002',
    );
    const jobId: string = render.body.job_id;

    const jobResponse = await request(app.getHttpServer()).get(`/v1/jobs/${jobId}`);
    expect(jobResponse.status).toBe(200);
    expect(jobResponse.body).toMatchObject({
      job_id: jobId,
      kind: 'render',
      status: 'queued',
      resource_id: null,
      error_code: null,
    });
    expect(typeof jobResponse.body.created_at).toBe('string');
    expect(typeof jobResponse.body.updated_at).toBe('string');

    const unknownJob = await request(app.getHttpServer()).get(
      '/v1/jobs/00000000-0000-4000-8000-000000000000',
    );
    expect(unknownJob.status).toBe(404);
    expect(unknownJob.body.code).toBe('SKIN_JOB_NOT_FOUND');

    const unknownConversation = await idempotentPost(
      '/v1/conversations/00000000-0000-4000-8000-000000000000/renders',
      { message: 'x' },
      'key-jobs-00003',
    );
    expect(unknownConversation.status).toBe(404);
    expect(unknownConversation.body.code).toBe('SKIN_CONVERSATION_NOT_FOUND');
  });

  it('finalize：候选不存在返回 404 problem；成功入队后再次确认 409', async () => {
    const created = await idempotentPost(
      '/v1/conversations',
      { initial_message: '星空法师' },
      'key-fin-000001',
    );
    const conversationId: string = created.body.conversation_id;

    const missing = await idempotentPost(
      `/v1/conversations/${conversationId}/finalize`,
      {
        candidate_id: '00000000-0000-4000-8000-000000000000',
        title: '星空法师',
        description: '描述',
      },
      'key-fin-000002',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('SKIN_CANDIDATE_NOT_FOUND');

    // 直接在数据库种一个候选，验证确认入队与重复确认冲突
    const render = await idempotentPost(
      `/v1/conversations/${conversationId}/renders`,
      { message: '星空法师' },
      'key-fin-000003',
    );
    const db = await import('@mc-plan/skin-db');
    const prisma = db.createPrismaClient(postgres.getConnectionUri());
    await prisma.candidate.create({
      data: {
        renderJobId: render.body.job_id,
        storageKey: 'candidates/seed.png',
        sha256: 'a'.repeat(64),
        byteSize: 100,
        mediaType: 'image/png',
        armModel: 'STEVE',
        secondLayer: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const candidate = await prisma.candidate.findUnique({
      where: { renderJobId: render.body.job_id },
    });
    await prisma.$disconnect();
    expect(candidate).not.toBeNull();

    const finalizeResponse = await idempotentPost(
      `/v1/conversations/${conversationId}/finalize`,
      { candidate_id: candidate?.id, title: '星空法师', description: '描述' },
      'key-fin-000004',
    );
    expect(finalizeResponse.status).toBe(202);
    expect(finalizeResponse.body).toMatchObject({ status: 'queued' });

    const duplicate = await idempotentPost(
      `/v1/conversations/${conversationId}/finalize`,
      { candidate_id: candidate?.id, title: '再次确认', description: '描述' },
      'key-fin-000005',
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SKIN_CONVERSATION_FINALIZING');
  });
});
