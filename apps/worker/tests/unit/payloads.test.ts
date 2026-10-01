import { describe, expect, it } from 'vitest';

import { finalizeJobPayloadSchema, renderJobPayloadSchema } from '../../src/payloads.js';

const validRenderPayload = {
  jobId: '0f14d0ab-9605-4d5b-a54f-83b2e57eab90',
  conversationId: '1f14d0ab-9605-4d5b-a54f-83b2e57eab91',
  attempt: 1,
  armModel: 'steve',
  prompt: '雪地探险家',
};

describe('任务载荷校验', () => {
  it('合法渲染载荷通过', () => {
    expect(renderJobPayloadSchema.parse(validRenderPayload)).toEqual(validRenderPayload);
  });

  it('非 UUID、非正 attempt、非法 armModel、空 prompt 被拒绝', () => {
    expect(() =>
      renderJobPayloadSchema.parse({ ...validRenderPayload, jobId: 'not-uuid' }),
    ).toThrow();
    expect(() => renderJobPayloadSchema.parse({ ...validRenderPayload, attempt: 0 })).toThrow();
    expect(() =>
      renderJobPayloadSchema.parse({ ...validRenderPayload, armModel: 'custom' }),
    ).toThrow();
    expect(() => renderJobPayloadSchema.parse({ ...validRenderPayload, prompt: '' })).toThrow();
  });

  it('合法确认载荷通过；缺失 title 或 candidateId 被拒绝', () => {
    const payload = {
      ...validRenderPayload,
      candidateId: '2f14d0ab-9605-4d5b-a54f-83b2e57eab92',
      title: '成品标题',
      description: '成品描述',
    };
    const { armModel, attempt, prompt, ...finalizePayload } = payload;
    void armModel;
    void attempt;
    void prompt;
    expect(finalizeJobPayloadSchema.parse(finalizePayload)).toEqual(finalizePayload);
    expect(() => finalizeJobPayloadSchema.parse({ ...payload, title: '' })).toThrow();
    expect(() => {
      const { candidateId, ...withoutCandidate } = payload;
      void candidateId;
      finalizeJobPayloadSchema.parse(withoutCandidate);
    }).toThrow();
  });
});
