import { z } from 'zod';

import {
  enrichSkinDesignDraft,
  renderSkinDesign,
  skinComponentDimensions,
  skinDesignDraftSchema,
  skinDesignSchema,
  type SkinComponentName,
  type SkinDesign,
} from './skin-design.js';
import type { ProviderGenerationRequest, ProviderGenerationResult } from './index.js';

/** LLM 对话客户端抽象：注入式设计，测试可离线 mock。 */
export interface LlmClient {
  complete(options: {
    system: string;
    user: string;
    timeoutMs?: number;
  }): Promise<{ content: string; providerCallId: string; inputUnits: number; outputUnits: number }>;
}

export class LlmClientError extends Error {
  constructor(
    readonly category: 'rate_limited' | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'LlmClientError';
  }
}

const COLD_PROMPT_WORDS = [
  '雪',
  '冰',
  '霜',
  '蓝',
  '青',
  '白',
  '冷',
  'snow',
  'ice',
  'frost',
  'blue',
  'cyan',
  'white',
  'cold',
];

const WARM_PROMPT_WORDS = [
  '沙',
  '漠',
  '暖',
  '红',
  '橙',
  '棕',
  '黄',
  'sand',
  'desert',
  'warm',
  'red',
  'orange',
  'brown',
];

/** 描述色温意图：与关键词表匹配则返回 'cold' / 'warm'，否则 null（不设约束）。 */
function promptColorIntention(prompt: string): 'cold' | 'warm' | null {
  const cold = COLD_PROMPT_WORDS.some((word) => prompt.includes(word));
  const warm = WARM_PROMPT_WORDS.some((word) => prompt.includes(word));
  if (cold && !warm) return 'cold';
  if (warm && !cold) return 'warm';
  return null;
}

function hueOf(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const delta = max - min;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/**
 * 描述-调色板色相一致性守门（v4 协议第四轮强化）：描述为强冷色主题时
 * palette 不得整体偏暖（红/橙/黄主导），反之亦然。只约束色温族而不
 * 规定具体颜色，避免把任何模板注入设计空间。返回 null 表示通过。
 */
function paletteHueGuard(prompt: string, design: SkinDesign): string | null {
  const intention = promptColorIntention(prompt);
  if (!intention) return null;

  let warm = 0;
  let cold = 0;
  for (const hex of Object.values(design.palette)) {
    const hue = hueOf(hex);
    if (hue < 0) continue;
    if (hue < 70 || hue >= 300) warm += 1;
    else if (hue >= 150 && hue < 300) cold += 1;
  }
  const total = warm + cold;
  if (total === 0) return null;

  if (intention === 'cold' && warm > cold) {
    return `调色板色温与描述冲突：描述为冷色主题，但调色板中红/橙/黄暖色 ${warm} 个多于蓝/青冷色 ${cold} 个；请把 palette 与网格整体改为冷色系（雪白、冰蓝、青灰），移除暖沙/棕/橙主导色`;
  }
  if (intention === 'warm' && cold > warm) {
    return `调色板色温与描述冲突：描述为暖色主题，但调色板中蓝/青冷色 ${cold} 个多于红/橙/黄暖色 ${warm} 个；请把 palette 与网格整体改为暖色系，移除冷蓝主导色`;
  }
  return null;
}

function providerFailure(error: unknown): ProviderGenerationResult {
  const category =
    error instanceof LlmClientError
      ? error.category
      : (error as Error).name === 'TimeoutError'
        ? 'timeout'
        : 'unavailable';
  return {
    status: 'failed',
    errorCode:
      category === 'rate_limited'
        ? 'PROVIDER_RATE_LIMITED'
        : category === 'timeout'
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_UNAVAILABLE',
    message:
      category === 'rate_limited'
        ? 'LLM 服务请求过于频繁'
        : category === 'timeout'
          ? 'LLM 调用超时'
          : 'LLM 服务当前不可用',
  };
}

const DESIGN_SYSTEM_PROMPT = [
  '你是 Minecraft Java 版 64×64 皮肤的像素设计师。',
  '根据用户描述亲自画出每个身体部件的像素蓝图，只输出一个 JSON 对象，不要解释或使用代码块。',
  '不要套用固定服装版型：发型、脸、轮廓、服装分区、饰物和不对称细节都必须直接体现在网格字符里。',
  '先逐词收集用户描述中的颜色词与服饰主题词，并为每个词指定落点：palette 必须直接服务这些词与描述场景（冷色场景用冷色系、暖色场景用暖色系），禁止替换成与描述无关的通用配色；concept 的 signature_details 逐词对应这些词，最终网格必须逐词自检落实。每个颜色词必须直接成为 palette 成员：例如描述含"蓝"则 palette 至少一个蓝色成员且该字符真实出现在网格；冷色场景（雪、冰、霜、夜、海）禁止红/橙/黄/棕暖色超过半数，暖色场景（沙、火、暖阳）禁止蓝/青冷色超过半数。',
  'JSON 顶层必须且只能包含 version、concept、palette、base、front、back、overlay_front、overlay_back。version 固定为 4。',
  'concept 先完成设计推理，包含 silhouette（轮廓）、outfit（完整穿搭）和 signature_details（3-5 个独有细节字符串）。这些内容必须在后续像素中真实出现。',
  'palette 是 6-16 个颜色，键只能用 A 到 P 的单字符，值必须是 #RRGGBB，例如 {"A":"#F1C7AE","B":"#A52D38"}。',
  'base 为每个部件指定一个 palette 字符，用于顶面、底面和安全底色。',
  'front 与 back 是完整不透明像素；每个字符都必须在 palette 中。',
  'overlay_front 与 overlay_back 是透明第二层像素；点号 . 表示透明，其余字符必须在 palette 中。',
  '六个部件键固定为 head、torso、right_arm、left_arm、right_leg、left_leg。',
  '网格尺寸严格如下：head 为 8 行且每行 8 字符；torso 为 12 行且每行 8 字符；四肢均为 12 行且每行 4 字符。',
  '每个 front、back、overlay_front、overlay_back 都必须完整包含上述六个部件，行从上到下，字符从角色自身左到右。',
  'overlay 两层合计至少画 12 个非点号像素并覆盖至少 2 个身体部件；只在轮廓外凸、发丝、衣物层次或饰物需要时画，不要整面复制 base。',
  '构图要求：先从描述提炼 3-5 个独有视觉特征，再把它们分布到头、躯干和四肢。',
  '服饰必须锚定到对应部位行带：围巾与项链画在 head 最下 1-2 行和 torso 最上 1-2 行的颈部环带，帽子与头饰画在 head 顶部 1-3 行，外套与斗篷铺满 torso 并用 overlay 表现翻领和前摆，腰带只画在 torso 最下 1-2 行，手套画在手臂最下 2-3 行，靴子画在腿部最下 3-4 行；用户没有提到的服饰不要凭空添加，更不要放错位置。',
  'back 是 front 的真实背面：正面每个服装分区、色块边界与 overlay 外凸，都要在背面相同的行带上出现对应像素；左右手臂与双腿的服装基色一致，细节可以对称呼应；overlay 与基础层的外边缘必须对齐，不得悬空偏移。',
  '头部和躯干正面都至少使用 3 种颜色，四肢正面各至少使用 2 种颜色，基础皮肤整体至少实际使用 6 种颜色。',
  '头部直接画出发际线、眼睛和表情；身体直接画出衣物边界、褶皱或标志，不存在任何预设夹克或盔甲。',
  '即使用户只描述人物外貌，也要为其原创一套完整穿搭；除非用户明确要求同色套装，不要把发色直接铺满上衣和裤子。',
  '不要机械使用竖直中线、腰带、齐膝分界或统一袖口；只有用户主题确实需要时才画这些像素。',
  '控制纯色块：相邻区域用 1 像素阴影、边缘高光或有意义的小图案塑造层次，但不要随机噪点。',
  '逐行细节下限：head 正面至少 5 种不同的行，torso 至少 6 种，四肢各至少 2 种；镜像行可以有，但禁止整段重复横条。',
  '局部语法示意：不要写 6 行相同的 DDDDDDDD；可按真实轮廓写成 DDEFFEDD、DEFGGFED、DEFGGFED、DDEFFEDD。只学习像素变化方法，不要复制此图案。',
  'JSON 形状提示（引号中的尺寸文字必须替换成真实字符串数组）：',
  '{"version":4,"concept":{"silhouette":"...","outfit":"...","signature_details":["...","...","..."]},"palette":{"A":"#RRGGBB","B":"#RRGGBB","C":"#RRGGBB","D":"#RRGGBB","E":"#RRGGBB","F":"#RRGGBB"},',
  '"base":{"head":"A","torso":"B","right_arm":"B","left_arm":"B","right_leg":"B","left_leg":"B"},',
  '"front":{"head":["8字符×8行"],"torso":["8字符×12行"],"right_arm":["4字符×12行"],"left_arm":["4字符×12行"],"right_leg":["4字符×12行"],"left_leg":["4字符×12行"]},',
  '"back":{"结构和尺寸同 front"},"overlay_front":{"结构和尺寸同 front，可用点号"},"overlay_back":{"结构和尺寸同 front，可用点号"}}',
  '输出前逐项自检：JSON 可解析；所有行数和行宽精确；没有未定义字符；front/back 没有点号；颜色与不同行数达到下限；overlay 至少 12 像素且覆盖 2 个部件；描述中每个颜色词与服饰词都出现在网格且位于正确部位行带；配色服务于描述场景而不是通用模板；back 与 front 行带一致且 overlay 与基础层边缘对齐。',
].join('\n');

const DETAIL_SYSTEM_PROMPT = [
  '你是 Minecraft 皮肤像素精修师。输入是一份尺寸正确但细节不足的角色草图。',
  '不要重写整份蓝图，只输出一个 JSON 对象：{"rows":[像素行补丁...]}，不要解释或使用代码块。',
  '每个补丁格式为 {"layer":"front|overlay_front","component":"head|torso|right_arm|left_arm|right_leg|left_leg","y":整数,"pixels":"整行字符"}。',
  'y 从 0 开始；head 行宽 8，torso 行宽 8，四肢行宽 4。front 只能使用 palette 中的 A-P，overlay_front 还允许点号表示透明。',
  '输出 12-36 个互不重复的行补丁。优先修正机器列出的问题，并把 concept 的每个 signature detail 映射为实际像素。',
  '至少 4 行用于 overlay_front 且覆盖两个部件；用它表现发丝、荷叶边、飘带、挂饰、衣摆或其他真实外凸层次。',
  '避免整行同色覆盖。使用 1 像素轮廓、内阴影、高光和左右不对称，让头、躯干与四肢形成多种不同像素行。',
  '补丁必须遵守部位锚定：围巾在颈部行带，帽饰在头顶行带，外套层次优先用 overlay_front 表现；不得把描述的主题色替换成通用配色；front 与 overlay 的外边缘必须对齐。',
  '只能使用输入 palette 已有字符；不要新增颜色，不要返回 concept、palette 或完整网格。',
].join('\n');

const rowPatchSchema = z.object({
  rows: z
    .array(
      z.object({
        layer: z.enum(['front', 'overlay_front']),
        component: z.enum(['head', 'torso', 'right_arm', 'left_arm', 'right_leg', 'left_leg']),
        y: z.number().int().min(0),
        pixels: z.string().regex(/^[A-P.]+$/),
      }),
    )
    .min(6)
    .max(160),
});

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('响应中未找到 JSON 对象');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(candidate.slice(start, index + 1));
    }
  }
  throw new Error('响应中的 JSON 对象不完整');
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

function parseDraft(
  content: string,
): { success: true; design: SkinDesign } | { success: false; feedback: string } {
  let value: unknown;
  try {
    value = extractJson(content);
  } catch (error) {
    return { success: false, feedback: `JSON 无法解析：${(error as Error).message}` };
  }

  const parsed = skinDesignDraftSchema.safeParse(value);
  if (parsed.success) return { success: true, design: parsed.data };
  return {
    success: false,
    feedback: parsed.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('；'),
  };
}

function designFeedback(
  design: SkinDesign,
): { success: true; design: SkinDesign } | { success: false; feedback: string } {
  const parsed = skinDesignSchema.safeParse(design);
  if (parsed.success) return { success: true, design: parsed.data };
  return {
    success: false,
    feedback: parsed.error.issues
      .slice(0, 16)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('；'),
  };
}

function applyRowPatches(
  design: SkinDesign,
  content: string,
): { success: true; design: SkinDesign } | { success: false; feedback: string } {
  let value: unknown;
  try {
    value = extractJson(content);
  } catch (error) {
    return { success: false, feedback: `补丁 JSON 无法解析：${(error as Error).message}` };
  }
  const parsed = rowPatchSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      feedback: parsed.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('；'),
    };
  }

  const unique = new Map<string, (typeof parsed.data.rows)[number]>();
  for (const patch of parsed.data.rows) {
    const { width, height } = skinComponentDimensions[patch.component];
    if (patch.y >= height) {
      return {
        success: false,
        feedback: `${patch.component} 行坐标 ${patch.y} 超出高度 ${height}`,
      };
    }
    if (patch.pixels.length !== width) {
      return { success: false, feedback: `${patch.component} 像素行宽必须为 ${width}` };
    }
    if (patch.layer === 'front' && patch.pixels.includes('.')) {
      return { success: false, feedback: 'front 行补丁不能使用透明点号' };
    }
    for (const symbol of patch.pixels) {
      if (symbol !== '.' && !(symbol in design.palette)) {
        return { success: false, feedback: `补丁使用了未定义颜色 ${symbol}` };
      }
    }
    unique.set(`${patch.layer}:${patch.component}:${patch.y}`, patch);
  }
  if (unique.size < 6) {
    return { success: false, feedback: '至少需要 6 个互不重复的有效像素行补丁' };
  }

  const next = structuredClone(design);
  for (const patch of unique.values()) {
    const layer = next[patch.layer] as Record<SkinComponentName, string[]>;
    layer[patch.component][patch.y] = patch.pixels;
  }
  return { success: true, design: next };
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
      '描述中的每个颜色词与服饰词都必须真实出现在最终像素中，并位于正确的身体部位。',
    ].join('\n');

    let draft: SkinDesign | undefined;
    let design: SkinDesign | undefined;
    let lastCompletion: Awaited<ReturnType<LlmClient['complete']>> | undefined;
    let inputUnits = 0;
    let outputUnits = 0;
    let draftPrompt = userPrompt;

    for (let pass = 0; pass < 2; pass += 1) {
      try {
        lastCompletion = await this.#client.complete({
          system: DESIGN_SYSTEM_PROMPT,
          user: draftPrompt,
        });
      } catch (error) {
        return providerFailure(error);
      }

      inputUnits += lastCompletion.inputUnits;
      outputUnits += lastCompletion.outputUnits;
      // 先解析、后判拒：思考型模型常在合法 JSON 前加"我无法直接绘制图像…"式开场白，
      // 只有在解析不出任何蓝图时才把响应定性为拒答，避免前言误杀有效输出。
      const parsed = parseDraft(lastCompletion.content);
      if (parsed.success) {
        // v4 协议第四轮强化：草稿一旦与描述色温冲突，第二次（最后一次）
        // 草稿机会专门用于修复调色板；仍冲突则接受草稿继续后续质量流程。
        const hueConflict = paletteHueGuard(request.prompt, parsed.design);
        if (hueConflict && pass === 0) {
          draftPrompt = [
            userPrompt,
            '上一份蓝图的调色板与描述色温冲突，请从头重画并修复：',
            hueConflict,
          ].join('\n');
          continue;
        }
        draft = parsed.design;
        break;
      }
      if (looksLikeRefusal(lastCompletion.content)) {
        return {
          status: 'failed',
          errorCode: 'PROVIDER_CONTENT_REJECTED',
          message: '模型拒绝了该创作描述',
          providerCallId: lastCompletion.providerCallId,
        };
      }
      if (pass === 0) {
        draftPrompt = [
          userPrompt,
          '上一份 JSON 的尺寸或字符协议不合法，请从头重画并修复：',
          parsed.feedback,
        ].join('\n');
      }
    }

    if (!draft) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_INVALID_RESPONSE',
        message: '模型连续两次无法输出合法尺寸的皮肤草图',
        ...(lastCompletion ? { providerCallId: lastCompletion.providerCallId } : {}),
      };
    }

    let quality = designFeedback(draft);
    if (quality.success) {
      design = quality.design;
    } else {
      let detailFeedback = quality.feedback;
      for (let pass = 0; pass < 1; pass += 1) {
        const detailPrompt = JSON.stringify({
          skin_description: request.prompt,
          arm_model: request.armModel,
          concept: draft.concept,
          palette: draft.palette,
          current_front: draft.front,
          current_overlay_front: draft.overlay_front,
          machine_quality_issues: detailFeedback,
        });
        try {
          lastCompletion = await this.#client.complete({
            system: DETAIL_SYSTEM_PROMPT,
            user: detailPrompt,
          });
        } catch {
          // 草图已经通过尺寸、字符与调色板协议；精修服务短暂不可用时，
          // 使用无服装语义的本地边界增强完成，而不是浪费用户的一次渲染机会。
          break;
        }

        inputUnits += lastCompletion.inputUnits;
        outputUnits += lastCompletion.outputUnits;

        const patched = applyRowPatches(draft, lastCompletion.content);
        if (patched.success) {
          draft = patched.design;
          quality = designFeedback(draft);
          if (quality.success) {
            design = quality.design;
            break;
          }
          detailFeedback = quality.feedback;
          continue;
        }
        if (looksLikeRefusal(lastCompletion.content)) {
          return {
            status: 'failed',
            errorCode: 'PROVIDER_CONTENT_REJECTED',
            message: '模型拒绝了该创作描述',
            providerCallId: lastCompletion.providerCallId,
          };
        }
        detailFeedback = patched.feedback;
      }
    }

    if (!design) {
      const enriched = designFeedback(enrichSkinDesignDraft(draft));
      if (enriched.success) design = enriched.design;
    }
    if (!design) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_INVALID_RESPONSE',
        message: '模型草图经过像素精修仍未达到质量门槛',
        ...(lastCompletion ? { providerCallId: lastCompletion.providerCallId } : {}),
      };
    }
    if (!lastCompletion) throw new Error('LLM completion state is unavailable');

    const png = renderSkinDesign(design, { armModel: request.armModel });
    void this.#environment;
    return {
      status: 'succeeded',
      png,
      providerCallId: `llm-${lastCompletion.providerCallId}`,
      usage: { inputUnits, outputUnits },
      safety: { passed: true, category: 'none' },
    };
  }
}

export type { ProviderGenerationRequest, ProviderGenerationResult };
