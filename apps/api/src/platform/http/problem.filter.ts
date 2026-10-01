import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@mc-plan/skin-contracts';

/**
 * 统一错误响应：application/problem+json，字段与公共契约 ProblemDetails 一致
 * （type、title、status、code、trace_id，可选 detail）。任何未知异常都不泄漏
 * 堆栈或内部值。
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { traceId?: string }>();
    const traceId = request.traceId ?? 'unknown';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : undefined;
      const problem: ProblemDetails = {
        type: 'about:blank',
        title: exception.name,
        status,
        code: httpStatusToCode(status),
        trace_id: traceId,
        ...(detail !== undefined ? { detail } : {}),
      };
      this.logger.error(`http_error status=${status} code=${problem.code} trace_id=${traceId}`);
      response.status(status).type('application/problem+json').send(problem);
      return;
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'SKIN_INTERNAL',
      trace_id: traceId,
    };
    this.logger.error(
      `unhandled_error name=${exception instanceof Error ? exception.name : 'unknown'} trace_id=${traceId}`,
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .type('application/problem+json')
      .send(problem);
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'SKIN_BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'SKIN_UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'SKIN_FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'SKIN_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'SKIN_CONFLICT';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SKIN_UNAVAILABLE';
    default:
      return 'SKIN_INTERNAL';
  }
}
