import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaDatabaseHealthAdapter } from '../../dist/platform/database/prisma-database-health.adapter.js';
import { PrismaService } from '../../dist/platform/database/prisma.service.js';
import { testConfig } from '../helpers/test-config.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('PostgreSQL 迁移与就绪（testcontainers）', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('mc_plan_skin_test')
      .withUsername('mc_plan_skin')
      .withPassword('local-test-only')
      .start();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('从空库应用提交的迁移并报告 ready', async () => {
    const databaseUrl = container.getConnectionUri();
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmExecutable, ['migration:deploy'], {
      cwd: packageRoot,
      env: { ...process.env, SKIN_DATABASE_URL: databaseUrl },
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });

    const prisma = new PrismaService(testConfig({ databaseUrl }));
    const readiness = new PrismaDatabaseHealthAdapter(prisma);

    await expect(readiness.check()).resolves.toEqual({
      ok: true,
      connection: 'up',
      migrations: 'current',
    });

    // 基线表真实存在且可写入：会话行 + 消息行 + 渲染任务行 + 候选行
    const client = prisma.client;
    const conversation = await client.conversation.create({
      data: {
        attemptsLimit: 3,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await client.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: '一位雪地探险家',
      },
    });
    const renderJob = await client.renderJob.create({
      data: {
        conversationId: conversation.id,
        attempt: 1,
        armModel: 'STEVE',
      },
    });
    await client.candidate.create({
      data: {
        renderJobId: renderJob.id,
        storageKey: `candidates/${conversation.id}.png`,
        sha256: 'a'.repeat(64),
        byteSize: 1024,
        mediaType: 'image/png',
        armModel: 'STEVE',
        secondLayer: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const stored = await client.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { messages: true, renderJobs: { include: { candidate: true } } },
    });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.messages).toHaveLength(1);
    expect(stored.renderJobs[0]?.candidate?.secondLayer).toBe(true);

    await prisma.onApplicationShutdown();
  });
});
