import 'reflect-metadata';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// e2e 针对编译后的 dist 运行：与生产产物一致，且 vitest 的 TS 转换
// 不支持 Nest 12 初始化所需的完整装饰器语义。
import { createApplication } from '../../dist/bootstrap.js';
import { testConfig } from '../helpers/test-config.js';
import type { INestApplication } from '@nestjs/common';

describe('健康探针 e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(
      testConfig({
        // 端口 1 上没有 PostgreSQL；readiness 必须报告 not_ready 而不是崩溃
        databaseUrl: 'postgresql://dead:dead@127.0.0.1:1/mc_plan_skin_dead',
      }),
    );
    // Nest 12 的 create() 不再自动初始化；路由注册发生在 init()/listen()
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('liveness 不依赖数据库，始终 200', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body).toEqual({ status: 'up' });
  });

  it('readiness 在数据库不可用时返回 503 not_ready', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.database).toBe('down');
  });

  it('响应携带 trace-id 头', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['trace-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('未知路由返回 problem+json 而不是默认 JSON 错误', async () => {
    const response = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('SKIN_NOT_FOUND');
    expect(typeof response.body.trace_id).toBe('string');
  });
});
