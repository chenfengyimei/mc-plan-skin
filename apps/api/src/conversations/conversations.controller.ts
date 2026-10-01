import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import { ConversationService } from './conversation.service.js';

const idempotencyKeySchema = z.string().min(8).max(200);

const createConversationSchema = z.object({
  initial_message: z.string().min(1).max(4000),
});

const createRenderSchema = z.object({
  message: z.string().min(1).max(4000),
  preferred_arm_model: z.enum(['steve', 'alex']).optional(),
});

const finalizeSchema = z.object({
  candidate_id: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(4000),
});

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'SKIN_BAD_REQUEST',
      message: '请求体不符合契约',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        code: issue.code,
      })),
    });
  }
  return parsed.data;
}

function requireIdempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'SKIN_BAD_REQUEST',
      message: '缺少或非法的 Idempotency-Key（8..200 字符）',
    });
  }
  return parsed.data;
}

/** 公共契约 0.1.0-draft 定义的四个操作；Official 集成端点在后续工作流接入。 */
@Controller('v1')
export class ConversationsController {
  public constructor(private readonly conversations: ConversationService) {}

  @Post('conversations')
  public async createConversation(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const input = parseOr400(createConversationSchema, body);
    return this.conversations.createConversation({
      initialMessage: input.initial_message,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('conversations/:conversationId/renders')
  @HttpCode(202)
  public async createRender(
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const input = parseOr400(createRenderSchema, body);
    return this.conversations.requestRender({
      conversationId,
      message: input.message,
      armModel: input.preferred_arm_model ?? 'steve',
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('conversations/:conversationId/finalize')
  @HttpCode(202)
  public async finalizeSkin(
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const input = parseOr400(finalizeSchema, body);
    return this.conversations.finalize({
      conversationId,
      candidateId: input.candidate_id,
      title: input.title,
      description: input.description,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Get('jobs/:jobId')
  public async getJob(@Param('jobId') jobId: string): Promise<unknown> {
    return this.conversations.getJob(jobId);
  }
}
