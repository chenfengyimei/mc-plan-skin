import { describe, expect, it } from 'vitest';
import { SKIN_CONTRACT_SOURCE, SKIN_CONTRACT_VERSION } from '../src/index.js';
import { typeProbes } from './type-probe.js';

describe('契约客户端类型', () => {
  it('引用 0.1.0-alpha.1 预发布契约（ADR-0012 匿名窗口）', () => {
    expect(SKIN_CONTRACT_VERSION).toBe('0.1.0-alpha.1');
    expect(SKIN_CONTRACT_SOURCE).toBe('mc-plan-contracts/openapi/skin.yaml');
  });

  it('会话状态与任务状态枚举来自契约', () => {
    expect(typeProbes.conversationStatuses).toContain('active');
    expect(typeProbes.conversationStatuses).toContain('expired');
    expect(typeProbes.jobStatuses).toContain('queued');
    expect(typeProbes.jobKind).toBe('render');
    expect(typeProbes.finalizeRequires).toContain('candidate_id');
  });

  it('alpha.1 匿名窗口新增操作与详情消息结构已生成', () => {
    expect(typeProbes.conversationDetailRequires).toContain('messages');
    expect(typeProbes.messageRoles).toContain('user');
    expect(typeProbes.messageRoles).toContain('assistant');
    expect(typeProbes.paths).toContain('/v1/conversations/{conversationId}');
  });
});
