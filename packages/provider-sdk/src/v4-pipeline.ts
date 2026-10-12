import { z } from 'zod';

import {
  skinComponentDimensions,
  skinDesignDraftSchema,
  skinDesignSchema,
  type SkinComponentName,
  type SkinDesign,
} from './skin-design.js';

/**
 * v4 逐像素蓝图协议的共享管线工具：文本直出适配器（LlmStructuredSkinProvider）
 * 与概念图视觉桥接适配器（ImageConceptSkinProvider）复用同一套 JSON 提取、
 * 尺寸/调色板校验、色温守门、拒答判定、行补丁精修与协议提示词，保证两条
 * Provider 路线的输出语义完全一致（业务层无差别感知 Provider 类型）。
 */

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
 * 描述-调色板色相一致性守门（v4 协议第四/五轮强化）：描述为强冷色主题时
 * palette 不得整体偏暖（红/橙/黄/棕主导），反之亦然。冷色只承认蓝-青蓝
 * 区（约 190°-290°）与高亮度低饱和的雪白；绿色与沙色不算冷色，防止
 * “海泡绿+棕”式的假冷色绕行。只约束色温族而不规定具体颜色，避免把
 * 任何模板注入设计空间。返回 null 表示通过。
 */
export function paletteHueGuard(prompt: string, design: SkinDesign): string | null {
  const intention = promptColorIntention(prompt);
  if (!intention) return null;

  let warm = 0;
  let cold = 0;
  for (const hex of Object.values(design.palette)) {
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const hue = hueOf(hex);
    if (hue < 0) continue;
    // 雪白/冰白（高亮度低饱和）在任何色相下都支持冷色场景。
    if (intention === 'cold' && max > 0.8 && saturation < 0.3) {
      cold += 1;
      continue;
    }
    if (hue < 70 || hue >= 300) warm += 1;
    else if (hue >= 190 && hue < 290) cold += 1;
    // 70°-190°（黄/黄绿/绿/黄沙区）与 290°-300° 不计入任何一方。
  }
  const total = warm + cold;
  if (total === 0) return null;

  if (intention === 'cold' && warm > cold) {
    return `调色板色温与描述冲突：描述为冷色主题，但调色板中红/橙/黄/棕暖色 ${warm} 个多于真正的冷色（蓝/青蓝/雪白）${cold} 个；绿色与沙色不算冷色。请把 palette 与网格整体改为冷色系（雪白、冰蓝、蓝灰），移除暖沙/棕/橙主导色`;
  }
  if (intention === 'warm' && cold > warm) {
    return `调色板色温与描述冲突：描述为暖色主题，但调色板中蓝/青冷色 ${cold} 个多于红/橙/黄暖色 ${warm} 个；请把 palette 与网格整体改为暖色系，移除冷蓝主导色`;
  }
  return null;
}

export const DESIGN_SYSTEM_PROMPT = [
  '你是 Minecraft Java 版 64×64 皮肤的像素设计师。',
  '根据用户描述亲自画出每个身体部件的像素蓝图，只输出一个 JSON 对象，不要解释或使用代码块。',
  '不要套用固定服装版型：发型、脸、轮廓、服装分区、饰物和不对称细节都必须直接体现在网格字符里。',
  '先逐词收集用户描述中的颜色词与服饰主题词，并为每个词指定落点：palette 必须直接服务这些词与描述场景（冷色场景用冷色系、暖色场景用暖色系），禁止替换成与描述无关的通用配色；concept 的 signature_details 逐词对应这些词，最终网格必须逐词自检落实。每个颜色词必须直接成为 palette 成员：例如描述含"蓝"则 palette 至少一个蓝色成员且该字符真实出现在网格。冷色场景（雪、冰、霜、夜、海）的 palette 必须以蓝、青蓝与雪白为主：绿色、青绿、沙色与棕色都不算冷色；红/橙/黄/棕暖色禁止超过半数。暖色场景（沙、火、暖阳）禁止蓝/青冷色超过半数。',
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
  '头部直接画出发际线、眼睛和表情；身体直接画出衣物边界、褶皱或标志，不存在任何预设夹克或盔甲。脸部必须可读：head 正面第 3-5 行内放两只 1-2 像素宽的深色眼睛（左右对称、水平间隔至少 2 像素），第 5-7 行内放 1-2 像素嘴或保暖面罩细节；眼睛与嘴的颜色必须明显深于肤色行，不得让脸整片糊成单一暗色。冷色场景的 palette 必须包含至少一个高亮度雪白/冰白（#E8F0F8、#F4FAFF 一族）并真实用于面部高光、围巾亮边或衣领翻边。',
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

export const DETAIL_SYSTEM_PROMPT = [
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

export function extractJson(content: string): unknown {
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

export function looksLikeRefusal(content: string): boolean {
  const lowered = content.toLowerCase();
  return (
    lowered.includes('无法') ||
    lowered.includes('不能协助') ||
    lowered.includes('i cannot') ||
    lowered.includes("i can't") ||
    lowered.includes('无法协助')
  );
}

export function parseDraft(
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

export function designFeedback(
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

export function applyRowPatches(
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

/**
 * 远程客户端传输错误归类：LlmClientError 与 ImageClientError 都携带
 * category 字段；原生 AbortSignal 超时表现为 TimeoutError。业务层只认
 * 标准 ProviderErrorCode，不解析任何厂商错误文本。
 */
export function classifyClientError(
  error: unknown,
): 'rate_limited' | 'timeout' | 'unavailable' {
  if (error instanceof Error) {
    const category = (error as { category?: unknown }).category;
    if (
      (error.name === 'LlmClientError' || error.name === 'ImageClientError') &&
      (category === 'rate_limited' || category === 'timeout' || category === 'unavailable')
    ) {
      return category;
    }
    if (error.name === 'TimeoutError') return 'timeout';
  }
  return 'unavailable';
}
