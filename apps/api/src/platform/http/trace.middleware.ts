import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** 为每个请求生成 trace_id，写入响应头并挂到 request 上供错误处理使用。 */
export class TraceMiddleware {
  public handle(request: Request, response: Response, next: NextFunction): void {
    const traceId = randomUUID();
    response.setHeader('trace-id', traceId);
    (request as Request & { traceId: string }).traceId = traceId;
    next();
  }
}
