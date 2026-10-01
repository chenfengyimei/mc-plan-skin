import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import type { ApiConfig } from '@mc-plan/skin-config';
import {
  QUEUE_NAMES,
  canRequestRender,
  type ConversationState,
  type FinalizeJobPayload,
  type RenderJobPayload,
} from '@mc-plan/skin-core';
import type { PrismaClient, RenderJob, SkinConversationStatus } from '@mc-plan/skin-db';
import { PRISMA_CLIENT } from '../platform/database/prisma.token.js';
import { FINALIZE_QUEUE, RENDER_QUEUE } from '../platform/queue/queue.module.js';
import { APP_CONFIG } from '../platform/config/config.token.js';
import { IdempotencyService } from './idempotency.service.js';

export interface ConversationDto {
  conversation_id: string;
  status: 'active' | 'finalizing' | 'completed' | 'expired' | 'cancelled';
  attempts_used: number;
  attempts_limit: number;
  expires_at: string;
}

export interface JobAcceptedDto {
  job_id: string;
  status: 'queued';
}

export interface JobDto {
  job_id: string;
  kind: 'render' | 'finalize';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  candidate_id: string | null;
  resource_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

const CONVERSATION_STATUS_MAP = {
  ACTIVE: 'active',
  FINALIZING: 'finalizing',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

const JOB_STATUS_MAP = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

/** Standalone 最小纵向链路：契约 0.1.0-draft 四个操作的领域编排。 */
@Injectable()
export class ConversationService implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(RENDER_QUEUE) private readonly renderQueue: Queue<RenderJobPayload>,
    @Inject(FINALIZE_QUEUE) private readonly finalizeQueue: Queue<FinalizeJobPayload>,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    private readonly idempotency: IdempotencyService,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.renderQueue.close();
    await this.finalizeQueue.close();
  }

  public async createConversation(input: {
    initialMessage: string;
    idempotencyKey: string;
  }): Promise<ConversationDto> {
    const operation = 'createConversation';
    const fingerprint = this.idempotency.fingerprint(input.initialMessage);
    const replay = await this.resolveReplay<ConversationDto>(
      operation,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay !== undefined) {
      return replay;
    }

    const now = new Date();
    const conversation = await this.prisma.conversation.create({
      data: {
        attemptsLimit: this.config.attemptsLimit,
        expiresAt: new Date(
          now.getTime() + this.config.conversationRetentionDays * 24 * 60 * 60 * 1000,
        ),
        messages: {
          create: { role: 'USER', content: input.initialMessage },
        },
      },
    });

    const dto = this.toConversationDto(conversation);
    await this.idempotency.store(operation, input.idempotencyKey, fingerprint, dto);
    return dto;
  }

  public async requestRender(input: {
    conversationId: string;
    message: string;
    armModel: 'steve' | 'alex';
    idempotencyKey: string;
  }): Promise<JobAcceptedDto> {
    const operation = 'requestRender';
    const body = {
      conversation_id: input.conversationId,
      message: input.message,
      preferred_arm_model: input.armModel,
    };
    const fingerprint = this.idempotency.fingerprint(body);
    const replay = await this.resolveReplay<JobAcceptedDto>(
      operation,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay !== undefined) {
      return replay;
    }

    let job: { id: string } | null = null;
    let acceptedAttempt = 0;
    // 唯一约束 (conversation_id, attempt) 保证并发下每个 attempt 只有一个受理者；
    // 冲突时带重读重试，使并发请求能够依次占满剩余次数。
    for (let guard = 0; guard <= this.config.attemptsLimit; guard += 1) {
      const current = await this.mustFindConversation(input.conversationId);
      const decision = canRequestRender(this.toState(current), this.systemClock());
      if (!decision.allowed) {
        throw this.renderRejection(decision.reason);
      }
      const attempt = current.attemptsUsed + 1;
      try {
        job = await this.prisma.renderJob.create({
          data: {
            conversationId: current.id,
            attempt,
            kind: 'RENDER',
            armModel: input.armModel === 'alex' ? 'ALEX' : 'STEVE',
            prompt: input.message,
          },
        });
        acceptedAttempt = attempt;
        break;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (!job) {
      throw new ConflictException({
        code: 'SKIN_ATTEMPTS_EXHAUSTED',
        message: '会话渲染次数已达上限',
      });
    }

    await this.prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        attemptsUsed: { increment: 1 },
        messages: { create: { role: 'USER', content: input.message } },
      },
    });

    await this.renderQueue.add(
      QUEUE_NAMES.render,
      {
        jobId: job.id,
        conversationId: input.conversationId,
        attempt: acceptedAttempt,
        armModel: input.armModel,
        prompt: input.message,
      },
      { jobId: job.id },
    );

    const dto: JobAcceptedDto = { job_id: job.id, status: 'queued' };
    await this.idempotency.store(operation, input.idempotencyKey, fingerprint, dto);
    return dto;
  }

  public async finalize(input: {
    conversationId: string;
    candidateId: string;
    title: string;
    description: string;
    idempotencyKey: string;
  }): Promise<JobAcceptedDto> {
    const operation = 'finalize';
    const body = {
      conversation_id: input.conversationId,
      candidate_id: input.candidateId,
      title: input.title,
    };
    const fingerprint = this.idempotency.fingerprint(body);
    const replay = await this.resolveReplay<JobAcceptedDto>(
      operation,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay !== undefined) {
      return replay;
    }

    const conversation = await this.mustFindConversation(input.conversationId);
    if (conversation.status === 'FINALIZING') {
      throw new ConflictException({
        code: 'SKIN_CONVERSATION_FINALIZING',
        message: '会话正在确认成品，不能重复确认',
      });
    }
    if (conversation.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'SKIN_CONVERSATION_NOT_ACTIVE',
        message: `会话状态 ${CONVERSATION_STATUS_MAP[conversation.status]} 不能确认成品`,
      });
    }

    const candidate = await this.prisma.candidate.findUnique({
      where: { id: input.candidateId },
      include: { renderJob: true },
    });
    if (!candidate || candidate.renderJob.conversationId !== conversation.id) {
      throw new NotFoundException({
        code: 'SKIN_CANDIDATE_NOT_FOUND',
        message: '候选不存在或不属于当前会话',
      });
    }

    const job = await this.prisma.renderJob
      .create({
        data: {
          conversationId: conversation.id,
          attempt: 0,
          kind: 'FINALIZE',
          armModel: candidate.armModel,
          prompt: input.title,
        },
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictException({
            code: 'SKIN_CONVERSATION_FINALIZING',
            message: '会话正在确认成品，不能重复确认',
          });
        }
        throw error;
      });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'FINALIZING' },
    });

    await this.finalizeQueue.add(
      QUEUE_NAMES.finalize,
      {
        jobId: job.id,
        conversationId: conversation.id,
        candidateId: candidate.id,
        title: input.title,
        description: input.description,
      },
      { jobId: job.id },
    );

    const dto: JobAcceptedDto = { job_id: job.id, status: 'queued' };
    await this.idempotency.store(operation, input.idempotencyKey, fingerprint, dto);
    return dto;
  }

  public async getJob(jobId: string): Promise<JobDto> {
    const job = await this.prisma.renderJob.findUnique({
      where: { id: jobId },
      include: { candidate: true },
    });
    if (!job) {
      throw new NotFoundException({
        code: 'SKIN_JOB_NOT_FOUND',
        message: '任务不存在',
      });
    }
    return this.toJobDto(job);
  }

  private async resolveReplay<T>(
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<T | undefined> {
    const existing = await this.idempotency.find<T>(operation, key, fingerprint);
    if (existing === undefined) {
      return undefined;
    }
    if (typeof existing === 'object' && existing !== null && 'conflict' in existing) {
      throw new ConflictException({
        code: 'SKIN_IDEMPOTENCY_CONFLICT',
        message: '幂等键已用于不同请求体',
      });
    }
    return existing;
  }

  private async mustFindConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'SKIN_CONVERSATION_NOT_FOUND',
        message: '会话不存在',
      });
    }
    return conversation;
  }

  private renderRejection(
    reason: 'EXPIRED' | 'NOT_ACTIVE' | 'ATTEMPTS_EXHAUSTED' | 'ALREADY_FINALIZING',
  ): ConflictException {
    const map = {
      EXPIRED: ['SKIN_CONVERSATION_EXPIRED', '会话已过期'],
      NOT_ACTIVE: ['SKIN_CONVERSATION_NOT_ACTIVE', '会话不在可渲染状态'],
      ATTEMPTS_EXHAUSTED: ['SKIN_ATTEMPTS_EXHAUSTED', '会话渲染次数已达上限'],
      ALREADY_FINALIZING: ['SKIN_CONVERSATION_FINALIZING', '会话正在确认成品'],
    } as const;
    const [code, message] = map[reason];
    return new ConflictException({ code, message });
  }

  private systemClock() {
    return { now: () => new Date() };
  }

  private toState(conversation: {
    status: SkinConversationStatus;
    attemptsUsed: number;
    attemptsLimit: number;
    createdAt: Date;
    expiresAt: Date;
  }): ConversationState {
    return {
      status: CONVERSATION_STATUS_MAP[conversation.status],
      attemptsUsed: conversation.attemptsUsed,
      attemptsLimit: conversation.attemptsLimit,
      createdAt: conversation.createdAt,
      expiresAt: conversation.expiresAt,
    };
  }

  private toConversationDto(conversation: {
    id: string;
    status: SkinConversationStatus;
    attemptsUsed: number;
    attemptsLimit: number;
    expiresAt: Date;
  }): ConversationDto {
    return {
      conversation_id: conversation.id,
      status: CONVERSATION_STATUS_MAP[conversation.status],
      attempts_used: conversation.attemptsUsed,
      attempts_limit: conversation.attemptsLimit,
      expires_at: conversation.expiresAt.toISOString(),
    };
  }

  private toJobDto(job: RenderJob & { candidate: { id: string } | null }): JobDto {
    return {
      job_id: job.id,
      kind: job.kind === 'FINALIZE' ? 'finalize' : 'render',
      status: JOB_STATUS_MAP[job.status],
      candidate_id: job.candidate?.id ?? null,
      // Standalone 模式没有 Community 资源；resource_id 在官方发布集成后接入
      resource_id: null,
      error_code: job.errorCode ?? null,
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
    };
  }
}
