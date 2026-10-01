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
      cwd: join(packageRoot, '..', '..', 'packages', 'db'),
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
    await prisma.onApplicationShutdown();
  });
});
