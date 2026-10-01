import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import type { ApiConfig } from '@mc-plan/skin-config';
import { StructuredLogger } from './platform/logging/structured-logger.js';
import { ProblemFilter } from './platform/http/problem.filter.js';
import { TraceMiddleware } from './platform/http/trace.middleware.js';

export async function createApplication(config: ApiConfig): Promise<INestApplication> {
  const logger = new StructuredLogger(config);
  const app = await NestFactory.create(AppModule.forRoot(config), { logger });
  const trace = new TraceMiddleware();
  app.use(trace.handle.bind(trace));
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
