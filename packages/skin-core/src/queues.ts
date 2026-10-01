export const QUEUE_NAMES = {
  render: 'skin-render',
  finalize: 'skin-finalize',
  retentionCleanup: 'skin-retention-cleanup',
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
