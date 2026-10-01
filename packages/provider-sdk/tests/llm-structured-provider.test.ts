import { describe, expect, it } from 'vitest';
import { validateSkinImage } from '@mc-plan/skin-validator';

import { LlmStructuredSkinProvider } from '../src/llm-structured-provider.js';
import type { ProviderGenerationRequest } from '../src/index.js';

const request: ProviderGenerationRequest = {
  prompt: '一位戴着蓝色围巾的雪地探险家',
  armModel: 'steve',
  attempt: 1,
  correlationId: 'corr-1',
};

const goodDesignJson = JSON.stringify({
  palette: {
    head: '#E0AC69',
    head_overlay: '#CC3333',
    torso: '#3B6EA5',
    torso_overlay: null,
    arm: '#E0AC69',
    arm_overlay: null,
    leg: '#2F3B52',
    leg_overlay: null,
    accent: '#F2D16B',
    eyes: '#2B4A8C',
  },
  patterns: [{ part: 'torso', kind: 'stripe', color: '#F2F2F2' }],
});

function providerWith(content: string): LlmStructuredSkinProvider {
  return new LlmStructuredSkinProvider({
    environment: 'test',
    client: {
      complete: async () => ({
        content,
        providerCallId: 'resp-123',
        inputUnits: 100,
        outputUnits: 50,
      }),
    },
  });
}

describe('LlmStructuredSkinProvider', () => {
  it('生产模式实例化被拒绝', () => {
    expect(
      () =>
        new LlmStructuredSkinProvider({
          environment: 'production',
          client: {
            complete: async () => ({
              content: '',
              providerCallId: 'x',
              inputUnits: 0,
              outputUnits: 0,
            }),
          },
        }),
    ).toThrow(/演示适配器/);
  });

  it('合法设计 JSON → 渲染 PNG 且通过 64×64 校验', async () => {
    const provider = providerWith(goodDesignJson);
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') {
      return;
    }
    expect(result.providerCallId).toBe('llm-resp-123');
    expect(result.safety.passed).toBe(true);
    expect(result.usage.inputUnits).toBe(100);
    const report = validateSkinImage(result.png, { armModel: 'steve' });
    expect(report.valid).toBe(true);
    expect(report.secondLayer).toBe(true);
  });

  it('确定性：同设计输入渲染同 SHA（provider 透传渲染器）', async () => {
    const provider = providerWith(goodDesignJson);
    const first = await provider.generate(request);
    const second = await provider.generate(request);
    if (first.status !== 'succeeded' || second.status !== 'succeeded') {
      expect.unreachable('合法 JSON 应当成功');
    }
    expect([...first.png]).toEqual([...second.png]);
  });

  it('格式错误的 LLM 输出 → PROVIDER_INVALID_RESPONSE（可重试）', async () => {
    const provider = providerWith('这不是 JSON');
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      return;
    }
    expect(result.errorCode).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('缺少必需调色板字段 → PROVIDER_INVALID_RESPONSE', async () => {
    const provider = providerWith('{"palette":{"head":"#FFFFFF"}}');
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      return;
    }
    expect(result.errorCode).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('模型拒答 → PROVIDER_CONTENT_REJECTED（不可重试）', async () => {
    const provider = providerWith('我无法协助完成该请求');
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      return;
    }
    expect(result.errorCode).toBe('PROVIDER_CONTENT_REJECTED');
  });

  it('代码块包裹的 JSON 也能解析', async () => {
    const provider = providerWith(`好的，以下是设计：\n\`\`\`json\n${goodDesignJson}\n\`\`\``);
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
  });
});
