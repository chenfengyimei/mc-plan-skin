import type { WorkerContext } from './worker-context.js';

/**
 * 保留清理（Foundation privacy-and-content.md）：
 * - 候选与失败对象 24 小时过期删除；
 * - 会话 30 天过期删除（含其候选对象与成品对象，级联删除数据库行）；
 * - 对象删除失败记录日志并继续，数据库错误抛出由 BullMQ 重试。
 */
export interface RetentionReport {
  deletedCandidates: number;
  deletedConversations: number;
  failedObjectDeletes: number;
}

export async function runRetentionCleanup(ctx: WorkerContext): Promise<RetentionReport> {
  const now = ctx.clock.now();
  const report: RetentionReport = {
    deletedCandidates: 0,
    deletedConversations: 0,
    failedObjectDeletes: 0,
  };

  const expiredCandidates = await ctx.db.candidate.findMany({
    where: { expiresAt: { lt: now } },
  });
  for (const candidate of expiredCandidates) {
    try {
      await ctx.storage.delete(candidate.storageKey);
    } catch (error) {
      report.failedObjectDeletes += 1;
      ctx.logger.error({
        event: 'retention_candidate_object_delete_failed',
        result: 'failure',
        error: (error as Error).name,
      });
      continue;
    }
    await ctx.db.candidate.delete({ where: { id: candidate.id } });
    report.deletedCandidates += 1;
  }

  const expiredConversations = await ctx.db.conversation.findMany({
    where: { expiresAt: { lt: now } },
    include: { renderJobs: { include: { candidate: true } }, finalizedSkin: true },
  });
  for (const conversation of expiredConversations) {
    const objectKeys = [
      ...conversation.renderJobs
        .map((job) => job.candidate?.storageKey)
        .filter((key): key is string => typeof key === 'string'),
      ...(conversation.finalizedSkin ? [conversation.finalizedSkin.storageKey] : []),
    ];
    for (const key of objectKeys) {
      try {
        await ctx.storage.delete(key);
      } catch (error) {
        report.failedObjectDeletes += 1;
        ctx.logger.error({
          event: 'retention_conversation_object_delete_failed',
          result: 'failure',
          error: (error as Error).name,
        });
      }
    }
    await ctx.db.conversation.delete({ where: { id: conversation.id } });
    report.deletedConversations += 1;
  }

  ctx.logger.info({
    event: 'retention_cleanup_completed',
    result: 'success',
    deleted_candidates: report.deletedCandidates,
    deleted_conversations: report.deletedConversations,
    failed_object_deletes: report.failedObjectDeletes,
  });
  return report;
}
