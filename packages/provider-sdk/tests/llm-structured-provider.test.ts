import { describe, expect, it } from 'vitest';
import { validateSkinImage } from '@mc-plan/skin-validator';

import {
  LlmClientError,
  LlmStructuredSkinProvider,
  type LlmClient,
} from '../src/llm-structured-provider.js';
import type { ProviderGenerationRequest } from '../src/index.js';

const request: ProviderGenerationRequest = {
  prompt: '一个可爱的萌妹子，红色头发',
  armModel: 'alex',
  attempt: 1,
  correlationId: 'corr-1',
};

const solid = (symbol: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => symbol.repeat(width));
const clear = (width: number, height: number): string[] =>
  Array.from({ length: height }, () => '.'.repeat(width));

function layer(symbol: string) {
  return {
    head: solid(symbol, 8, 8),
    torso: solid(symbol, 8, 12),
    right_arm: solid(symbol, 4, 12),
    left_arm: solid(symbol, 4, 12),
    right_leg: solid(symbol, 4, 12),
    left_leg: solid(symbol, 4, 12),
  };
}

const front = layer('D');
front.head = [
  'BBBBBBBB',
  'BBBBBBBB',
  'BBBAAABB',
  'BBAAAABB',
  'AACACCAA',
  'AAAAAAAA',
  'AAFAFAAA',
  'AAAAAAAA',
];
front.torso = [
  'DDFFFFDD',
  'DFFFFFFD',
  'DDFEEFDD',
  'DDFFFFDD',
  'DDDFFDDD',
  'DDDEEDDD',
  'DDDEEDDD',
  'DDFFFFDD',
  'DDFEEFDD',
  'DDFFFFDD',
  'DDEEEEDD',
  'EEEEEEEE',
];
front.right_arm[0] = 'FFFF';
front.right_arm[1] = 'EEEE';
front.left_arm[0] = 'FFFF';
front.left_arm[1] = 'EEEE';
front.right_leg[0] = 'FFFF';
front.right_leg[1] = 'EEEE';
front.left_leg[0] = 'FFFF';
front.left_leg[1] = 'EEEE';
const overlayFront = {
  head: [
    'B......B',
    'BB....BB',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ],
  torso: ['..FFFF..', ...clear(8, 11)],
  right_arm: ['FFFF', ...clear(4, 11)],
  left_arm: clear(4, 12),
  right_leg: clear(4, 12),
  left_leg: clear(4, 12),
};

const goodDesignJson = JSON.stringify({
  version: 4,
  concept: {
    silhouette: '红色不对称长发与纤细轮廓',
    outfit: '深紫短裙搭配炭黑长袜',
    signature_details: ['金色领结', '侧边发夹', '左右不对称袖口'],
  },
  palette: {
    A: '#E8B08A',
    B: '#B52B38',
    C: '#2B4A8C',
    D: '#5B3A77',
    E: '#28283B',
    F: '#F2D16B',
  },
  base: {
    head: 'A',
    torso: 'D',
    right_arm: 'D',
    left_arm: 'D',
    right_leg: 'E',
    left_leg: 'E',
  },
  front,
  back: layer('E'),
  overlay_front: overlayFront,
  overlay_back: {
    head: clear(8, 8),
    torso: clear(8, 12),
    right_arm: clear(4, 12),
    left_arm: clear(4, 12),
    right_leg: clear(4, 12),
    left_leg: clear(4, 12),
  },
});

const repairPatchJson = JSON.stringify({
  rows: [
    { layer: 'overlay_front', component: 'head', y: 0, pixels: 'B......B' },
    { layer: 'overlay_front', component: 'head', y: 1, pixels: 'BB....BB' },
    { layer: 'overlay_front', component: 'torso', y: 0, pixels: '..FFFF..' },
    { layer: 'overlay_front', component: 'right_arm', y: 0, pixels: 'FFFF' },
    { layer: 'front', component: 'head', y: 0, pixels: 'BBBBBBBB' },
    { layer: 'front', component: 'torso', y: 0, pixels: 'DDFFFFDD' },
  ],
});

function providerWith(content: string, captureSystem?: (system: string) => void) {
  const client: LlmClient = {
    complete: async (options) => {
      captureSystem?.(options.system);
      return {
        content,
        providerCallId: 'resp-123',
        inputUnits: 100,
        outputUnits: 50,
      };
    },
  };
  return new LlmStructuredSkinProvider({ environment: 'test', client });
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

  it('合法逐像素蓝图渲染为含第二层的 64×64 Alex PNG', async () => {
    const provider = providerWith(goodDesignJson);
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;

    expect(result.providerCallId).toBe('llm-resp-123');
    expect(result.safety.passed).toBe(true);
    expect(result.usage.inputUnits).toBe(100);
    const report = validateSkinImage(result.png, { armModel: 'alex' });
    expect(report.valid).toBe(true);
    expect(report.secondLayer).toBe(true);
  });

  it('system prompt 要求直接画像素且不含旧雪地探险家/服装枚举模板', async () => {
    let system = '';
    const provider = providerWith(goodDesignJson, (value) => {
      system = value;
    });
    await provider.generate(request);
    expect(system).toContain('像素蓝图');
    expect(system).toContain('overlay 至少 12 像素且覆盖 2 个部件');
    expect(system).not.toContain('雪地探险家');
    expect(system).not.toContain('outerwear');
    expect(system).not.toContain('belt');
    expect(system).not.toContain('boots');
  });

  it('确定性：同设计输入渲染同字节', async () => {
    const provider = providerWith(goodDesignJson);
    const first = await provider.generate(request);
    const second = await provider.generate(request);
    if (first.status !== 'succeeded' || second.status !== 'succeeded') {
      expect.unreachable('合法 JSON 应当成功');
    }
    expect([...first.png]).toEqual([...second.png]);
  });

  it('格式错误的 LLM 输出 → PROVIDER_INVALID_RESPONSE（可重试）', async () => {
    const result = await providerWith('这不是 JSON').generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('首份蓝图不合法时携带具体校验反馈重试一次', async () => {
    const invalid = JSON.parse(goodDesignJson) as Record<string, unknown>;
    invalid.overlay_front = {
      head: clear(8, 8),
      torso: clear(8, 12),
      right_arm: clear(4, 12),
      left_arm: clear(4, 12),
      right_leg: clear(4, 12),
      left_leg: clear(4, 12),
    };
    let calls = 0;
    let repairPrompt = '';
    const provider = new LlmStructuredSkinProvider({
      environment: 'test',
      client: {
        complete: async (options) => {
          calls += 1;
          if (calls === 2) repairPrompt = options.user;
          return {
            content: calls === 1 ? JSON.stringify(invalid) : repairPatchJson,
            providerCallId: `resp-${calls}`,
            inputUnits: 100,
            outputUnits: 50,
          };
        },
      },
    });

    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(calls).toBe(2);
    expect(repairPrompt).toContain('overlay 至少需要 12 个非透明像素');
    expect(result.providerCallId).toBe('llm-resp-2');
    expect(result.usage).toEqual({ inputUnits: 200, outputUnits: 100 });
  });

  it('远程像素精修暂时失败时使用本地边界增强完成合法候选', async () => {
    const flat = JSON.parse(goodDesignJson) as Record<string, unknown>;
    flat.overlay_front = {
      head: clear(8, 8),
      torso: clear(8, 12),
      right_arm: clear(4, 12),
      left_arm: clear(4, 12),
      right_leg: clear(4, 12),
      left_leg: clear(4, 12),
    };
    let calls = 0;
    const provider = new LlmStructuredSkinProvider({
      environment: 'test',
      client: {
        complete: async () => {
          calls += 1;
          if (calls > 1) throw new Error('detail service unavailable');
          return {
            content: JSON.stringify(flat),
            providerCallId: 'draft-1',
            inputUnits: 100,
            outputUnits: 50,
          };
        },
      },
    });

    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(calls).toBe(2);
    expect(validateSkinImage(result.png, { armModel: 'alex' }).secondLayer).toBe(true);
  });

  it('完全透明的 overlay 会被通用边界精修补足而不是流入 validator 失败', async () => {
    const value = JSON.parse(goodDesignJson) as Record<string, unknown>;
    value.overlay_front = {
      head: clear(8, 8),
      torso: clear(8, 12),
      right_arm: clear(4, 12),
      left_arm: clear(4, 12),
      right_leg: clear(4, 12),
      left_leg: clear(4, 12),
    };
    const result = await providerWith(JSON.stringify(value)).generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(validateSkinImage(result.png, { armModel: 'alex' }).secondLayer).toBe(true);
  });

  it('模型拒答 → PROVIDER_CONTENT_REJECTED（不可重试）', async () => {
    const result = await providerWith('我无法协助完成该请求').generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('PROVIDER_CONTENT_REJECTED');
  });

  it.each([
    ['rate_limited', 'PROVIDER_RATE_LIMITED'],
    ['timeout', 'PROVIDER_TIMEOUT'],
    ['unavailable', 'PROVIDER_UNAVAILABLE'],
  ] as const)('LLM 客户端 %s 错误映射为 %s', async (category, errorCode) => {
    const provider = new LlmStructuredSkinProvider({
      environment: 'test',
      client: {
        complete: async () => {
          throw new LlmClientError(category, 'redacted upstream failure');
        },
      },
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe(errorCode);
    expect(result.message).not.toContain('redacted upstream failure');
  });

  it('代码块包裹的 JSON 也能解析', async () => {
    const result = await providerWith(
      `好的，以下是设计：\n\`\`\`json\n${goodDesignJson}\n\`\`\``,
    ).generate(request);
    expect(result.status).toBe('succeeded');
  });

  it('完整 JSON 后的多余对象不会污染首个设计对象', async () => {
    const result = await providerWith(`${goodDesignJson}\n补充说明：{}`).generate(request);
    expect(result.status).toBe('succeeded');
  });
});
