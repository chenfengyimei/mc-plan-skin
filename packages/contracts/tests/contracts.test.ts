import { describe, expect, it } from 'vitest';
import { SKIN_CONTRACT_SOURCE, SKIN_CONTRACT_VERSION } from '../src/index.js';
import { typeProbes } from './type-probe.js';

describe('契约客户端类型', () => {
  it('引用 0.1.0-draft 预发布契约', () => {
    expect(SKIN_CONTRACT_VERSION).toBe('0.1.0-draft');
    expect(SKIN_CONTRACT_SOURCE).toBe('mc-plan-contracts/openapi/skin.yaml');
  });

  it('会话状态与任务状态枚举来自契约', () => {
    expect(typeProbes.conversationStatuses).toContain('active');
    expect(typeProbes.conversationStatuses).toContain('expired');
    expect(typeProbes.jobStatuses).toContain('queued');
    expect(typeProbes.jobKind).toBe('render');
    expect(typeProbes.finalizeRequires).toContain('candidate_id');
  });
});
