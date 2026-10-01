import type { components, paths } from '@mc-plan/skin-contracts';
import type { Clock } from './clock.js';

/** 会话状态：与公共契约 `Conversation.status` 保持一致，不在本仓库重新定义语义。 */
export type ConversationStatus = components['schemas']['Conversation']['status'];

type CreateRenderBody = NonNullable<
  paths['/v1/conversations/{conversationId}/renders']['post']['requestBody']
>['content']['application/json'];

/** 手臂模型：与公共契约 `preferred_arm_model` 一致。 */
export type ArmModel = NonNullable<CreateRenderBody['preferred_arm_model']>;

export interface ConversationState {
  status: ConversationStatus;
  attemptsUsed: number;
  attemptsLimit: number;
  createdAt: Date;
  /** 会话创建后按对话保留期（默认 30 天）计算出的过期时刻。 */
  expiresAt: Date;
}

export const TERMINAL_STATUSES: readonly ConversationStatus[] = [
  'completed',
  'expired',
  'cancelled',
];

export function createConversationState(options: {
  createdAt: Date;
  retentionDays: number;
  attemptsLimit: number;
}): ConversationState {
  if (options.retentionDays < 1) {
    throw new Error('retentionDays 必须为正整数');
  }
  if (options.attemptsLimit < 1) {
    throw new Error('attemptsLimit 必须为正整数');
  }
  return {
    status: 'active',
    attemptsUsed: 0,
    attemptsLimit: options.attemptsLimit,
    createdAt: options.createdAt,
    expiresAt: new Date(options.createdAt.getTime() + options.retentionDays * 24 * 60 * 60 * 1000),
  };
}

export function isExpired(state: ConversationState, clock: Clock): boolean {
  return clock.now().getTime() >= state.expiresAt.getTime();
}

/** 会话过期判断必须先于其他状态转换。 */
export function effectiveStatus(state: ConversationState, clock: Clock): ConversationStatus {
  if (TERMINAL_STATUSES.includes(state.status)) {
    return state.status;
  }
  if (isExpired(state, clock)) {
    return 'expired';
  }
  return state.status;
}

export type RenderRequestRejection =
  'EXPIRED' | 'NOT_ACTIVE' | 'ATTEMPTS_EXHAUSTED' | 'ALREADY_FINALIZING';

/**
 * 判定当前会话是否允许发起下一次实际渲染。并发场景下的最终裁决由数据库
 * 事务与唯一约束保证；本函数是纯领域规则。
 */
export function canRequestRender(
  state: ConversationState,
  clock: Clock,
): { allowed: true } | { allowed: false; reason: RenderRequestRejection } {
  const status = effectiveStatus(state, clock);
  if (status === 'expired') {
    return { allowed: false, reason: 'EXPIRED' };
  }
  if (status === 'finalizing') {
    return { allowed: false, reason: 'ALREADY_FINALIZING' };
  }
  if (status !== 'active') {
    return { allowed: false, reason: 'NOT_ACTIVE' };
  }
  if (state.attemptsUsed >= state.attemptsLimit) {
    return { allowed: false, reason: 'ATTEMPTS_EXHAUSTED' };
  }
  return { allowed: true };
}

/** 记录一次实际渲染被受理后，会话已用次数 +1。 */
export function recordRenderAccepted(state: ConversationState): ConversationState {
  if (state.attemptsUsed >= state.attemptsLimit) {
    throw new Error('渲染次数已用尽，不能再次受理');
  }
  return { ...state, attemptsUsed: state.attemptsUsed + 1 };
}

export function startFinalizing(state: ConversationState, clock: Clock): ConversationState {
  const status = effectiveStatus(state, clock);
  if (status !== 'active') {
    throw new Error(`状态 ${status} 不能进入 finalizing`);
  }
  return { ...state, status: 'finalizing' };
}

export function completeConversation(state: ConversationState): ConversationState {
  if (state.status !== 'finalizing') {
    throw new Error(`状态 ${state.status} 不能进入 completed`);
  }
  return { ...state, status: 'completed' };
}

export function cancelConversation(state: ConversationState, clock: Clock): ConversationState {
  const status = effectiveStatus(state, clock);
  if (status === 'completed' || status === 'cancelled') {
    throw new Error(`状态 ${status} 不能取消`);
  }
  return { ...state, status: 'cancelled' };
}
