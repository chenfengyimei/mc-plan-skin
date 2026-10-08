import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  StreamableFile,
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

/** 公共契约 0.1.0-alpha.1 定义的八个操作；Official 集成端点在后续工作流接入。 */
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

  @Get('conversations/:conversationId')
  public async getConversation(@Param('conversationId') conversationId: string): Promise<unknown> {
    return this.conversations.getConversationDetail(conversationId);
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  public async deleteConversation(@Param('conversationId') conversationId: string): Promise<void> {
    await this.conversations.deleteConversation(conversationId);
  }

  @Get('conversations/:conversationId/candidates/:candidateId/preview')
  @Header('cache-control', 'no-store')
  public async getCandidatePreview(
    @Param('conversationId') conversationId: string,
    @Param('candidateId') candidateId: string,
  ): Promise<StreamableFile> {
    const bytes = await this.conversations.getCandidatePreview(conversationId, candidateId);
    return new StreamableFile(new Uint8Array(bytes), { type: 'image/png' });
  }

  @Get('conversations/:conversationId/skins/:resourceId/download')
  @Header('cache-control', 'no-store')
  public async downloadSkin(
    @Param('conversationId') conversationId: string,
    @Param('resourceId') resourceId: string,
  ): Promise<StreamableFile> {
    const bytes = await this.conversations.downloadSkin(conversationId, resourceId);
    return new StreamableFile(new Uint8Array(bytes), { type: 'image/png' });
  }
}
