import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ProblemFilter } from '../../src/platform/http/problem.filter.js';

interface Capture {
  status: number;
  contentType: string;
  body: unknown;
}

function catchProblem(exception: unknown, traceId: string | undefined): Capture {
  const capture: Capture = { status: 0, contentType: '', body: undefined };
  const request = { traceId };
  const response = {
    status: (code: number) => {
      capture.status = code;
      return response;
    },
    type: (contentType: string) => {
      capture.contentType = contentType;
      return response;
    },
    send: (body: unknown) => {
      capture.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  const filter = new ProblemFilter();
  filter.catch(exception, host);
  return capture;
}

describe('ProblemFilter', () => {
  it('HttpException 映射为 problem+json 且携带 trace_id 与稳定 code', () => {
    const capture = catchProblem(new HttpException('不存在', HttpStatus.NOT_FOUND), 'trace-123');
    expect(capture.status).toBe(404);
    expect(capture.contentType).toBe('application/problem+json');
    const problem = capture.body as Record<string, unknown>;
    expect(problem['code']).toBe('SKIN_NOT_FOUND');
    expect(problem['trace_id']).toBe('trace-123');
    expect(problem['status']).toBe(404);
    expect(problem['detail']).toBe('不存在');
  });

  it('未知异常统一为 500 SKIN_INTERNAL，不泄漏堆栈', () => {
    const capture = catchProblem(new Error('secret database internals'), 'trace-456');
    expect(capture.status).toBe(500);
    const problem = capture.body as Record<string, unknown>;
    expect(problem['code']).toBe('SKIN_INTERNAL');
    expect(problem['trace_id']).toBe('trace-456');
    expect(JSON.stringify(problem)).not.toContain('secret database internals');
  });

  it('缺失 trace_id 时使用 unknown 而不是抛错', () => {
    const capture = catchProblem(new Error('boom'), undefined);
    const problem = capture.body as Record<string, unknown>;
    expect(problem['trace_id']).toBe('unknown');
  });

  it('常见 HTTP 状态映射到稳定错误码', () => {
    expect(catchProblem(new HttpException('c', HttpStatus.CONFLICT), 't').status).toBe(409);
    const notReady = catchProblem(
      new HttpException('db down', HttpStatus.SERVICE_UNAVAILABLE),
      't',
    );
    const problem = notReady.body as Record<string, unknown>;
    expect(problem['code']).toBe('SKIN_UNAVAILABLE');
  });
});
