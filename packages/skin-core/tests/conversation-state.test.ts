import { describe, expect, it } from 'vitest';
import {
  FixedClock,
  cancelConversation,
  canRequestRender,
  completeConversation,
  createConversationState,
  effectiveStatus,
  recordRenderAccepted,
  startFinalizing,
} from '../src/index.js';

const createdAt = new Date('2026-10-01T00:00:00Z');
const day = 24 * 60 * 60 * 1000;

function activeConversation(
  overrides: Partial<{ attemptsUsed: number; attemptsLimit: number }> = {},
) {
  return createConversationState({
    createdAt,
    retentionDays: 30,
    attemptsLimit: overrides.attemptsLimit ?? 3,
  });
}

describe('会话状态机', () => {
  it('新会话为 active，保留期默认 30 天', () => {
    const state = activeConversation();
    expect(state.status).toBe('active');
    expect(state.expiresAt.getTime() - state.createdAt.getTime()).toBe(30 * day);
    expect(state.attemptsLimit).toBe(3);
  });

  it('最多三次实际渲染：第四次被拒绝', () => {
    const clock = new FixedClock(new Date('2026-10-02T00:00:00Z'));
    let state = activeConversation();
    expect(canRequestRender(state, clock)).toEqual({ allowed: true });
    state = recordRenderAccepted(state);
    state = recordRenderAccepted(state);
    state = recordRenderAccepted(state);
    expect(state.attemptsUsed).toBe(3);
    expect(canRequestRender(state, clock)).toEqual({
      allowed: false,
      reason: 'ATTEMPTS_EXHAUSTED',
    });
  });

  it('超过保留期后会话过期，拒绝渲染', () => {
    const beforeExpiry = new FixedClock(new Date('2026-10-30T23:59:59Z'));
    const afterExpiry = new FixedClock(new Date('2026-10-31T00:00:01Z'));
    const state = activeConversation();
    expect(effectiveStatus(state, beforeExpiry)).toBe('active');
    expect(effectiveStatus(state, afterExpiry)).toBe('expired');
    expect(canRequestRender(state, afterExpiry)).toEqual({ allowed: false, reason: 'EXPIRED' });
  });

  it('finalizing 会话拒绝新的渲染请求', () => {
    const clock = new FixedClock(new Date('2026-10-02T00:00:00Z'));
    const state = startFinalizing(activeConversation(), clock);
    expect(canRequestRender(state, clock)).toEqual({
      allowed: false,
      reason: 'ALREADY_FINALIZING',
    });
  });

  it('completed 会话拒绝新的渲染请求', () => {
    const clock = new FixedClock(new Date('2026-10-02T00:00:00Z'));
    const state = completeConversation(startFinalizing(activeConversation(), clock));
    expect(canRequestRender(state, clock)).toEqual({ allowed: false, reason: 'NOT_ACTIVE' });
  });

  it('非 finalizing 状态不能进入 completed', () => {
    expect(() => completeConversation(activeConversation())).toThrow(/不能进入 completed/);
  });

  it('active 会话可以取消，completed 会话不能取消', () => {
    const clock = new FixedClock(new Date('2026-10-02T00:00:00Z'));
    expect(cancelConversation(activeConversation(), clock).status).toBe('cancelled');
    const completed = completeConversation(startFinalizing(activeConversation(), clock));
    expect(() => cancelConversation(completed, clock)).toThrow(/不能取消/);
  });

  it('已耗尽的渲染次数不能被重复受理', () => {
    let state = activeConversation();
    state = recordRenderAccepted(state);
    state = recordRenderAccepted(state);
    state = recordRenderAccepted(state);
    expect(() => recordRenderAccepted(state)).toThrow(/已用尽/);
  });
});
