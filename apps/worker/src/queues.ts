/** BullMQ 队列名称。渲染、确认与清理队列在纵向链路工作流中接线；本骨架使用 ping 队列验证执行机制。 */
export const QUEUE_NAMES = {
  render: 'skin-render',
  finalize: 'skin-finalize',
  retentionCleanup: 'skin-retention-cleanup',
  skeletonPing: 'skin-skeleton-ping',
} as const;

export interface SkeletonPingJob {
  pingId: string;
  sentAt: string;
}
