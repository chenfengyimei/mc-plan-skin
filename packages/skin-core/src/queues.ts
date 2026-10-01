export const QUEUE_NAMES = {
  render: 'skin-render',
  finalize: 'skin-finalize',
  retentionCleanup: 'skin-retention-cleanup',
} as const;

/**
 * 失败任务语义（standards：testing.md）：可重试错误指数退避重试共 3 次尝试，
 * 耗尽后进入 failed（可处理的死信状态）。Queue/入队侧使用；不依赖 bullmq 类型。
 */
export const SKIN_RETRYABLE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 100,
} as const;

/** 渲染任务载荷：只携带标识与创作输入，不携带任何用户身份数据。 */
export interface RenderJobPayload {
  jobId: string;
  conversationId: string;
  attempt: number;
  armModel: 'steve' | 'alex';
  prompt: string;
}

/** 确认成品任务载荷。 */
export interface FinalizeJobPayload {
  jobId: string;
  conversationId: string;
  candidateId: string;
  title: string;
  description: string;
}
