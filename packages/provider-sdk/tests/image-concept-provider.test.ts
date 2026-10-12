import { describe, expect, it } from 'vitest';
import { validateSkinImage } from '@mc-plan/skin-validator';

import { ImageClientError, type ImageClient } from '../src/image-client.js';
import { ImageConceptSkinProvider } from '../src/image-concept-provider.js';
import { LlmClientError } from '../src/llm-structured-provider.js';
import type { VisionClient } from '../src/vision-client.js';
import type { ProviderGenerationRequest } from '../src/index.js';

const request: ProviderGenerationRequest = {
  prompt: '一个可爱的萌妹子，红色头发',
  armModel: 'alex',
  attempt: 1,
  correlationId: 'corr-1',
};

const CONCEPT_IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

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

function imageClientSpy(onGenerate?: (prompt: string) => void): ImageClient {
  return {
    generate: async (options) => {
      onGenerate?.(options.prompt);
      return {
        image: CONCEPT_IMAGE,
        providerCallId: 'img-call-9',
        inputUnits: 33,
        outputUnits: 1024,
      };
    },
  };
}

function visionScript(responses: Array<string | Error>): {
  client: VisionClient;
  systems: string[];
  images: Array<Uint8Array>;
  count: () => number;
} {
  let calls = 0;
  const systems: string[] = [];
  const images: Array<Uint8Array> = [];
  return {
    systems,
    images,
    count: () => calls,
    client: {
      extract: async (options) => {
        calls += 1;
        systems.push(options.system);
        images.push(options.image);
        const item = responses[Math.min(calls - 1, responses.length - 1)];
        if (item instanceof Error) throw item;
        if (item === undefined) throw new Error('scripted vision response exhausted');
        return {
          content: item,
          providerCallId: `vision-${calls}`,
          inputUnits: 100,
          outputUnits: 50,
        };
      },
    },
  };
}

describe('ImageConceptSkinProvider（概念图→视觉提取→v4 蓝图两跳管线）', () => {
  it('生产模式实例化被拒绝', () => {
    expect(
      () =>
        new ImageConceptSkinProvider({
          environment: 'production',
          imageClient: imageClientSpy(),
          visionClient: visionScript([]).client,
        }),
    ).toThrow(/演示适配器/);
  });

  it('两跳成功：概念图字节交给视觉客户端，蓝图渲染为合法双层 PNG', async () => {
    const vision = visionScript([goodDesignJson]);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: vision.client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;

    expect(vision.images[0]).toEqual(CONCEPT_IMAGE);
    expect(result.providerCallId).toBe('img-img-call-9:vision-1');
    expect(result.usage).toEqual({ inputUnits: 133, outputUnits: 1074 });
    const report = validateSkinImage(result.png, { armModel: 'alex' });
    expect(report.valid).toBe(true);
    expect(report.secondLayer).toBe(true);
  });

  it('确定性：同一概念图与视觉输出渲染同字节', async () => {
    const makeProvider = () =>
      new ImageConceptSkinProvider({
        environment: 'test',
        imageClient: imageClientSpy(),
        visionClient: visionScript([goodDesignJson]).client,
      });
    const first = await makeProvider().generate(request);
    const second = await makeProvider().generate(request);
    if (first.status !== 'succeeded' || second.status !== 'succeeded') {
      expect.unreachable('固定输入应当成功');
    }
    expect([...first.png]).toEqual([...second.png]);
  });

  it('图像客户端错误映射标准错误码且不透出厂商文本', async () => {
    const imageClient: ImageClient = {
      generate: async () => {
        throw new ImageClientError('rate_limited', 'upstream secret detail');
      },
    };
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient,
      visionClient: visionScript([goodDesignJson]).client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('PROVIDER_RATE_LIMITED');
    expect(result.message).not.toContain('upstream secret detail');
  });

  it.each([
    ['rate_limited', 'PROVIDER_RATE_LIMITED'],
    ['timeout', 'PROVIDER_TIMEOUT'],
    ['unavailable', 'PROVIDER_UNAVAILABLE'],
  ] as const)('视觉通道 %s 错误映射为 %s', async (category, errorCode) => {
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: visionScript([new LlmClientError(category, 'vision hop failed')]).client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe(errorCode);
  });

  it('视觉模型拒答 → PROVIDER_CONTENT_REJECTED', async () => {
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: visionScript(['我无法协助完成该请求']).client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('PROVIDER_CONTENT_REJECTED');
  });

  it('开场白含拒答字样但携带合法 JSON 时不被误判（与文本路线一致）', async () => {
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: visionScript([
        `抱歉，我无法直接绘制图像，但可以用网格表示：\n${goodDesignJson}`,
      ]).client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
  });

  it('连续两次非法 JSON → PROVIDER_INVALID_RESPONSE', async () => {
    const vision = visionScript(['这不是 JSON', '还是不是 JSON']);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: vision.client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('PROVIDER_INVALID_RESPONSE');
    expect(vision.count()).toBe(2);
  });

  it('色温守门冲突时只重读同一概念图一次（不重画概念图）', async () => {
    const warm = JSON.parse(goodDesignJson) as Record<string, unknown>;
    warm.palette = {
      A: '#E8B08A',
      B: '#B52B38',
      C: '#C97B3A',
      D: '#8A5A2B',
      E: '#6B4423',
      F: '#F2D16B',
    };
    const coldRequest: ProviderGenerationRequest = {
      ...request,
      prompt: '一位来自冰原的雪地探险家，蓝色围巾',
    };
    let imageCalls = 0;
    const vision = visionScript([JSON.stringify(warm), goodDesignJson]);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(() => {
        imageCalls += 1;
      }),
      visionClient: vision.client,
    });
    const result = await provider.generate(coldRequest);
    expect(result.status).toBe('succeeded');
    expect(imageCalls).toBe(1);
    expect(vision.count()).toBe(2);
    expect(vision.images).toHaveLength(2);
    expect(vision.images[0]).toEqual(CONCEPT_IMAGE);
    expect(vision.images[1]).toEqual(CONCEPT_IMAGE);
  });

  it('质量不足时经视觉精修补丁修复（复用行补丁协议）', async () => {
    const flat = JSON.parse(goodDesignJson) as Record<string, unknown>;
    flat.overlay_front = {
      head: clear(8, 8),
      torso: clear(8, 12),
      right_arm: clear(4, 12),
      left_arm: clear(4, 12),
      right_leg: clear(4, 12),
      left_leg: clear(4, 12),
    };
    const vision = visionScript([JSON.stringify(flat), repairPatchJson]);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: vision.client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(vision.count()).toBe(2);
    expect(vision.systems[1]).toContain('像素精修师');
    expect(validateSkinImage(result.png, { armModel: 'alex' }).secondLayer).toBe(true);
  });

  it('视觉精修服务短暂不可用时使用本地边界增强完成合法候选', async () => {
    const flat = JSON.parse(goodDesignJson) as Record<string, unknown>;
    flat.overlay_front = {
      head: clear(8, 8),
      torso: clear(8, 12),
      right_arm: clear(4, 12),
      left_arm: clear(4, 12),
      right_leg: clear(4, 12),
      left_leg: clear(4, 12),
    };
    const vision = visionScript([JSON.stringify(flat), new Error('detail unavailable')]);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: vision.client,
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(validateSkinImage(result.png, { armModel: 'alex' }).secondLayer).toBe(true);
  });

  it('视觉提取使用与文本直出完全相同的 v4 设计 system prompt', async () => {
    const vision = visionScript([goodDesignJson]);
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy(),
      visionClient: vision.client,
    });
    await provider.generate(request);
    expect(vision.systems[0]).toContain('像素蓝图');
    expect(vision.systems[0]).toContain('overlay 两层合计至少画 12 个非点号像素');
    expect(vision.systems[0]).toContain('冷色场景（雪、冰、霜、夜、海）');
  });

  it('概念图提示词包含用户描述且不含关联 ID 与密钥', async () => {
    let captured = '';
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient: imageClientSpy((prompt) => {
        captured = prompt;
      }),
      visionClient: visionScript([goodDesignJson]).client,
    });
    await provider.generate(request);
    expect(captured).toContain(request.prompt);
    expect(captured).not.toContain('corr-1');
  });

  it('可选尺寸透传给图像客户端', async () => {
    let capturedSize: string | undefined;
    const imageClient: ImageClient = {
      generate: async (options) => {
        capturedSize = options.size;
        return {
          image: CONCEPT_IMAGE,
          providerCallId: 'img-call-9',
          inputUnits: 33,
          outputUnits: 1024,
        };
      },
    };
    const provider = new ImageConceptSkinProvider({
      environment: 'test',
      imageClient,
      visionClient: visionScript([goodDesignJson]).client,
      imageSize: '1024x1024',
    });
    const result = await provider.generate(request);
    expect(result.status).toBe('succeeded');
    expect(capturedSize).toBe('1024x1024');
  });
});
