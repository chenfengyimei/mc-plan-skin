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
  'JSON schema（v3，支持材质、逐面花纹与服装剪裁）：',
  '{"palette":{"skin":"#RRGGBB","hair":"#RRGGBB","head_overlay":"#RRGGBB|null","shirt":"#RRGGBB",',
  '"shirt_overlay":"#RRGGBB|null","sleeve":"#RRGGBB","arm_overlay":"#RRGGBB|null","pants":"#RRGGBB",',
  '"leg_overlay":"#RRGGBB|null","boots":"#RRGGBB","scarf":"#RRGGBB|null","belt":"#RRGGBB|null",',
  '"accent":"#RRGGBB","secondary":"#RRGGBB","eyes":"#RRGGBB","eyebrows":"#RRGGBB"},',
  '"hair":{"style":"short|with_bangs|long","fringe_rows":0-3,"highlights":true|false,"part":"left|center|right"},',
  '"face":{"eye_style":"round|narrow|bright","expression":"neutral|soft_smile|serious","freckles":true|false},',
  '"clothing":{"outerwear":"none|jacket|robe|armor","collar":"none|round|high","scarf":true|false,',
  '"belt":true|false,"cuffs":true|false,"gloves":true|false,"knee_pads":true|false,"boots":true|false,',
  '"boot_height":2-5,"sleeve_length":"short|long"},',
  '"texture":{"skin":"smooth|freckled","hair":"solid|layered|streaked",',
  '"upper":"smooth|cloth|denim|leather|metal|weathered","lower":"smooth|cloth|denim|leather|metal|weathered",',
  '"intensity":0-0.35},',
  '"patterns":[{"part":"head|torso|arm|leg","kind":"solid|stripe|pinstripe|checker|diagonal|gradient|border|panel|chevron|speckle",',
  '"placement":"all|front|sides|back","color":"#RRGGBB","secondary_color":"#RRGGBB|null","scale":1-4}]}',
  '规则：颜色必须是 6 位十六进制；overlay 色仅在需要帽沿、外套边缘或护甲外层时填写，否则为 null；',
  'patterns 最多 10 条，优先使用 2-4 条互相协调的图案，不要用 solid 覆盖全部材质；',
  '使用 front placement 做胸甲、徽记或夹克门襟，使用 all/sides 时保证图案在各面协调；',
  '配色采用主色、secondary 辅色和 accent 点缀的 60/30/10 层次，避免大面积高饱和纯色。',
  '高质量示例（雪地探险家）：',
  '{"palette":{"skin":"#E8B08A","hair":"#5A4634","head_overlay":null,"shirt":"#3B6EA5","shirt_overlay":null,',
  '"sleeve":"#3B6EA5","arm_overlay":null,"pants":"#4A5A6E","leg_overlay":null,"boots":"#6B4A2E",',
  '"scarf":"#C84B3C","belt":"#5A4634","accent":"#F2D16B","secondary":"#294F78",',
  '"eyes":"#2B4A8C","eyebrows":"#5A4634"},',
  '"hair":{"style":"with_bangs","fringe_rows":2,"highlights":true,"part":"left"},',
  '"face":{"eye_style":"bright","expression":"soft_smile","freckles":true},',
  '"clothing":{"outerwear":"jacket","collar":"high","scarf":true,"belt":true,"cuffs":true,',
  '"gloves":true,"knee_pads":false,"boots":true,"boot_height":4,"sleeve_length":"long"},',
  '"texture":{"skin":"freckled","hair":"layered","upper":"cloth","lower":"denim","intensity":0.18},',
  '"patterns":[{"part":"torso","kind":"panel","placement":"front","color":"#2B4A6E","secondary_color":null,"scale":2},',
  '{"part":"arm","kind":"stripe","placement":"all","color":"#8BB8D8","secondary_color":null,"scale":3},',
  '{"part":"leg","kind":"speckle","placement":"all","color":"#8A9AB0","secondary_color":null,"scale":2}]}',
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

    const png = renderSkinDesign(design, { armModel: request.armModel });
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
