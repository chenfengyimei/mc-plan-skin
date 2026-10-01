import { describe, expect, it } from 'vitest';

import { parseSkeletonPingJob } from '../../src/skeleton-ping.js';

describe('骨架任务载荷校验', () => {
  it('合法载荷通过并保留字段', () => {
    const parsed = parseSkeletonPingJob({
      pingId: 'ping-1',
      sentAt: '2026-10-01T12:00:00.000Z',
    });
    expect(parsed.pingId).toBe('ping-1');
  });

  it('缺失字段被拒绝', () => {
    expect(() => parseSkeletonPingJob({ sentAt: '2026-10-01T12:00:00.000Z' })).toThrow();
  });

  it('非 ISO 时间被拒绝', () => {
    expect(() => parseSkeletonPingJob({ pingId: 'a', sentAt: 'yesterday' })).toThrow();
  });

  it('空 pingId 与超长 pingId 被拒绝', () => {
    expect(() =>
      parseSkeletonPingJob({ pingId: '', sentAt: '2026-10-01T12:00:00.000Z' }),
    ).toThrow();
    expect(() =>
      parseSkeletonPingJob({ pingId: 'a'.repeat(65), sentAt: '2026-10-01T12:00:00.000Z' }),
    ).toThrow();
  });

  it('非对象输入被拒绝', () => {
    expect(() => parseSkeletonPingJob('not-an-object')).toThrow();
    expect(() => parseSkeletonPingJob(null)).toThrow();
  });
});
