import { renderSkinDesign, skinDesignSchema, type SkinDesign } from './skin-design.js';
import type { ProviderGenerationRequest, ProviderGenerationResult } from './index.js';

/** LLM 对话客户端抽象：注入式设计，测试可离线 mock。 */
export interface LlmClient {
  complete(options: {
    system: string;
    user: string;
    timeoutMs?: number;
  }): Promise<{ content: string; providerCallId: string; inputUnits: number; outputUnits: number }>;
}

const DESIGN_SYSTEM_PROMPT = [
  '你是 Minecraft Java 版 64×64 皮肤的像素设计师。',
  '根据用户描述输出皮肤设计 JSON，只输出 JSON 本体，不要输出任何其他文字或代码块标记。',
  'JSON schema（v2，支持发型/脸部/服装层次）：',
  '{"palette":{"skin":"#RRGGBB","hair":"#RRGGBB","head_overlay":"#RRGGBB|null","shirt":"#RRGGBB",',
  '"shirt_overlay":"#RRGGBB|null","sleeve":"#RRGGBB","arm_overlay":"#RRGGBB|null","pants":"#RRGGBB",',
  '"leg_overlay":"#RRGGBB|null","boots":"#RRGGBB","scarf":"#RRGGBB|null","belt":"#RRGGBB|null",',
  '"accent":"#RRGGBB","eyes":"#RRGGBB","eyebrows":"#RRGGBB"},',
  '"hair":{"style":"short|with_bangs|long","fringe_rows":0-2},',
  '"face":{"eye_style":"round|narrow","mouth":true|false},',
  '"clothing":{"scarf":true|false,"belt":true|false,"boots":true|false,"sleeve_length":"short|long"},',
  '"patterns":[{"part":"head|torso|arm|leg","kind":"solid|stripe|border|speckle","color":"#RRGGBB"}]}',
  '规则：颜色必须是 6 位十六进制；head_overlay/shirt_overlay 等用于帽子/外套第二层（无则 null）；',
  'scarf 围巾绕脖、belt 腰带、boots 靴子按描述决定；patterns 装饰最多 8 条；',
  '配色需符合用户描述的主题与情绪，注意颜色和谐（同类色/对比色搭配）。',
  '高质量示例（雪地探险家）：',
  '{"palette":{"skin":"#E8B08A","hair":"#5A4634","head_overlay":null,"shirt":"#3B6EA5","shirt_overlay":null,',
  '"sleeve":"#3B6EA5","arm_overlay":null,"pants":"#4A5A6E","leg_overlay":null,"boots":"#6B4A2E",',
  '"scarf":"#C84B3C","belt":"#5A4634","accent":"#F2D16B","eyes":"#2B4A8C","eyebrows":"#5A4634"},',
  '"hair":{"style":"with_bangs","fringe_rows":2},"face":{"eye_style":"round","mouth":true},',
  '"clothing":{"scarf":true,"belt":true,"boots":true,"sleeve_length":"long"},',
  '"patterns":[{"part":"torso","kind":"border","color":"#2B4A6E"},{"part":"leg","kind":"speckle","color":"#8A9AB0"}]}',
  '模仿此示例的结构丰富度与配色和谐度，但主题、色相须跟随用户描述变化。',
].join('\n');

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('响应中未找到 JSON 对象');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function looksLikeRefusal(content: string): boolean {
  const lowered = content.toLowerCase();
  return (
    lowered.includes('无法') ||
    lowered.includes('不能协助') ||
    lowered.includes('i cannot') ||
    lowered.includes("i can't") ||
    lowered.includes('无法协助')
  );
}

export interface LlmStructuredSkinProviderOptions {
  client: LlmClient;
  environment: 'development' | 'test' | 'production';
}

/**
 * 多模态文本模型适配器：LLM 直接输出结构化皮肤设计 JSON，
 * 由确定性渲染器生成 64×64 PNG（模型无法产生非法布局）。
 * 生产模式禁止使用（演示/开发适配器，Q-001 正式绑定仍需基准 ADR）。
 */
export class LlmStructuredSkinProvider {
  readonly #client: LlmClient;
  readonly #environment: 'development' | 'test' | 'production';

  constructor(options: LlmStructuredSkinProviderOptions) {
    if (options.environment === 'production') {
      throw new Error('生产模式禁止使用 LlmStructuredSkinProvider（演示适配器，Q-001 未决）');
    }
    this.#client = options.client;
    this.#environment = options.environment;
  }

  get name(): string {
    return 'llm-structured';
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const userPrompt = [
      `皮肤描述：${request.prompt}`,
      `手臂模型：${request.armModel}（4px=Steve 风格，3px=Alex 风格，只影响配色倾向）`,
      `这是本次会话的第 ${request.attempt} 次渲染。`,
    ].join('\n');

    let completion;
    try {
      completion = await this.#client.complete({
        system: DESIGN_SYSTEM_PROMPT,
        user: userPrompt,
        timeoutMs: 30_000,
      });
    } catch (error) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_TIMEOUT',
        message: `LLM 调用失败：${(error as Error).name}`,
      };
    }

    if (looksLikeRefusal(completion.content)) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_CONTENT_REJECTED',
        message: '模型拒绝了该创作描述',
        providerCallId: completion.providerCallId,
      };
    }

    let design: SkinDesign;
    try {
      design = skinDesignSchema.parse(extractJson(completion.content));
    } catch {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_INVALID_RESPONSE',
        message: '模型输出不符合皮肤设计 schema',
        providerCallId: completion.providerCallId,
      };
    }

    const png = renderSkinDesign(design);
    void this.#environment;
    return {
      status: 'succeeded',
      png,
      providerCallId: `llm-${completion.providerCallId}`,
      usage: { inputUnits: completion.inputUnits, outputUnits: completion.outputUnits },
      safety: { passed: true, category: 'none' },
    };
  }
}

export type { ProviderGenerationRequest, ProviderGenerationResult };
