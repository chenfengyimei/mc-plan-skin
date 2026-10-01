import { parseFinalizeJobPayload } from './payloads.js';
import { validateSkinImage } from '@mc-plan/skin-validator';

import type { WorkerContext } from './worker-context.js';

/**
 * 确认处理器（Standalone）：重新校验候选字节 → 存储成品 → 记录 FinalizedSkin →
 * 会话转 COMPLETED。Official 模式的发布链路在后续工作流接入。
 */
export async function processFinalizeJob(ctx: WorkerContext, rawPayload: unknown): Promise<void> {
  const payload = parseFinalizeJobPayload(rawPayload);

  const job = await ctx.db.renderJob.findUnique({
    where: { id: payload.jobId },
  });
  if (!job || job.kind !== 'FINALIZE') {
    ctx.logger.error({
      event: 'finalize_job_row_missing',
      result: 'failure',
      job_id: payload.jobId,
    });
    throw new Error('finalize job row missing');
  }
  if (job.status === 'SUCCEEDED') {
    return;
  }

  await ctx.db.renderJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING' },
  });

  const candidate = await ctx.db.candidate.findUnique({
    where: { id: payload.candidateId },
  });
  if (!candidate) {
    await ctx.db.renderJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorCode: 'SKIN_CANDIDATE_NOT_FOUND' },
    });
    ctx.logger.error({
      event: 'finalize_candidate_missing',
      result: 'failure',
      job_id: job.id,
    });
    return;
  }

  const bytes = await ctx.storage.get(candidate.storageKey);
  const armModel = candidate.armModel === 'ALEX' ? 'alex' : 'steve';
  const report = validateSkinImage(bytes, { armModel });
  if (!report.valid) {
    // 候选在确认前已损坏：会话回退 ACTIVE，删除失败的确认任务行以允许重试
    await ctx.db.$transaction([
      ctx.db.renderJob.delete({ where: { id: job.id } }),
      ctx.db.conversation.update({
        where: { id: payload.conversationId },
        data: { status: 'ACTIVE' },
      }),
    ]);
    ctx.logger.error({
      event: 'finalize_validation_failed',
      result: 'failure',
      job_id: job.id,
      error_code: 'SKIN_VALIDATION_FAILED',
      issues: report.issues.map((issue) => issue.code),
    });
    return;
  }

  const storageKey = `finals/${payload.conversationId}.png`;
  const stored = await ctx.storage.put(storageKey, bytes, report.mediaType);

  await ctx.db.finalizedSkin.upsert({
    where: { conversationId: payload.conversationId },
    create: {
      conversationId: payload.conversationId,
      storageKey,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
      mediaType: report.mediaType,
      armModel: candidate.armModel,
      secondLayer: report.secondLayer,
      title: payload.title,
      description: payload.description,
    },
    update: { sha256: stored.sha256 },
  });
  await ctx.db.renderJob.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED' },
  });
  await ctx.db.conversation.update({
    where: { id: payload.conversationId },
    data: { status: 'COMPLETED' },
  });

  ctx.logger.info({
    event: 'finalize_succeeded',
    result: 'success',
    job_id: job.id,
    conversation_id: payload.conversationId,
    sha256: stored.sha256,
  });
}
