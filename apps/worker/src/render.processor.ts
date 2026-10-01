import type { Job } from 'bullmq';

import { candidateStorageKey, newCandidateId } from '@mc-plan/skin-core';
import {
  isRetryableProviderError,
  type ProviderGenerationRequest,
} from '@mc-plan/skin-provider-sdk';
import { validateSkinImage } from '@mc-plan/skin-validator';

import { parseRenderJobPayload } from './payloads.js';
import type { WorkerContext } from './worker-context.js';

/** 可重试提供商错误在 BullMQ 上的最大尝试次数（含首次）。 */
const RENDER_ATTEMPTS = 3;

/** 渲染处理器：Fake Provider/未来正式适配器 → 64×64 校验 → 隔离存储 → 候选行。 */
export async function processRenderJob(
  ctx: WorkerContext,
  rawPayload: unknown,
  bullJob: Job,
): Promise<void> {
  const payload = parseRenderJobPayload(rawPayload);

  const job = await ctx.db.renderJob.findUnique({ where: { id: payload.jobId } });
  if (!job) {
    // 任务行缺失属于数据一致性问题：直接失败，不无限重试
    ctx.logger.error({
      event: 'render_job_row_missing',
      result: 'failure',
      job_id: payload.jobId,
    });
    throw new Error('render job row missing');
  }
  if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
    ctx.logger.warn({
      event: 'render_job_already_settled',
      result: 'warning',
      job_id: job.id,
      status: job.status,
    });
    return;
  }

  await ctx.db.renderJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING' },
  });

  const request: ProviderGenerationRequest = {
    prompt: payload.prompt,
    armModel: payload.armModel,
    attempt: payload.attempt,
    correlationId: job.id,
  };
  const result = await ctx.provider.generate(request);

  if (result.status === 'failed') {
    const attemptsMade = bullJob.attemptsMade;
    if (isRetryableProviderError(result.errorCode) && attemptsMade < RENDER_ATTEMPTS - 1) {
      ctx.logger.warn({
        event: 'render_provider_retryable',
        result: 'warning',
        job_id: job.id,
        error_code: result.errorCode,
        attempt: attemptsMade + 1,
      });
      throw new Error(result.errorCode);
    }
    await ctx.db.renderJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorCode: result.errorCode },
    });
    ctx.logger.error({
      event: 'render_provider_failed',
      result: 'failure',
      job_id: job.id,
      error_code: result.errorCode,
    });
    return;
  }

  const report = validateSkinImage(result.png, { armModel: payload.armModel });
  if (!report.valid) {
    await ctx.db.renderJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorCode: 'SKIN_VALIDATION_FAILED',
        providerCallId: result.providerCallId,
      },
    });
    ctx.logger.error({
      event: 'render_validation_failed',
      result: 'failure',
      job_id: job.id,
      error_code: 'SKIN_VALIDATION_FAILED',
      issues: report.issues.map((issue) => issue.code),
    });
    return;
  }

  const candidateId = newCandidateId();
  const storageKey = candidateStorageKey(candidateId);
  const stored = await ctx.storage.put(storageKey, result.png, report.mediaType);
  const expiresAt = new Date(
    ctx.clock.now().getTime() + ctx.candidateRetentionHours * 60 * 60 * 1000,
  );

  await ctx.db.candidate.create({
    data: {
      id: candidateId,
      renderJobId: job.id,
      storageKey,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
      mediaType: report.mediaType,
      armModel: payload.armModel === 'alex' ? 'ALEX' : 'STEVE',
      secondLayer: report.secondLayer,
      expiresAt,
    },
  });
  await ctx.db.renderJob.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED', providerCallId: result.providerCallId },
  });

  ctx.logger.info({
    event: 'render_succeeded',
    result: 'success',
    job_id: job.id,
    candidate_id: candidateId,
    sha256: stored.sha256,
    byte_size: stored.byteSize,
  });
}
