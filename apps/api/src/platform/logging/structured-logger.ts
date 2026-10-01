import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

import type { ApiConfig } from '@mc-plan/skin-config';

/** 结构化 JSON 日志（standards/observability.md）。 */
export class StructuredLogger implements LoggerService {
  readonly #logger: Logger;

  public constructor(config: ApiConfig) {
    this.#logger = pino({
      level: config.logLevel,
      base: {
        service: 'skin-api',
        environment: config.env,
        run_mode: config.runMode,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'access_token',
          'refresh_token',
          'password',
          'email',
          'databaseUrl',
          'SKIN_DATABASE_URL',
          'prompt',
        ],
        censor: '[REDACTED]',
      },
      messageKey: 'event',
    });
  }

  public log(message: unknown, context?: string): void {
    this.#logger.info({ context, result: 'success' }, String(message));
  }

  public error(message: unknown, trace?: string, context?: string): void {
    this.#logger.error({ context, result: 'failure', trace }, String(message));
  }

  public warn(message: unknown, context?: string): void {
    this.#logger.warn({ context, result: 'warning' }, String(message));
  }

  public debug(message: unknown, context?: string): void {
    this.#logger.debug({ context, result: 'debug' }, String(message));
  }

  public verbose(message: unknown, context?: string): void {
    this.#logger.trace({ context, result: 'trace' }, String(message));
  }
}
