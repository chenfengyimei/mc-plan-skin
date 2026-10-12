import { enrichSkinDesignDraft, renderSkinDesign, type SkinDesign } from './skin-design.js';
import type { ProviderGenerationRequest, ProviderGenerationResult } from './index.js';
import type { ImageClient } from './image-client.js';
import type { VisionClient } from './vision-client.js';
import {
  applyRowPatches,
  classifyClientError,
  DESIGN_SYSTEM_PROMPT,
  designFeedback,
  DETAIL_SYSTEM_PROMPT,
  looksLikeRefusal,
  paletteHueGuard,
  parseDraft,
} from './v4-pipeline.js';

export interface ImageConceptSkinProviderOptions {
  imageClient: ImageClient;
  visionClient: VisionClient;
  environment: 'development' | 'test' | 'production';
  /** 概念图可选尺寸（如 1024x1024），透传给图像客户端。 */
  imageSize?: string | undefined;
  imageTimeoutMs?: number;
  visionTimeoutMs?: number;
}

function hopFailure(hop: 'image' | 'vision', error: unknown): ProviderGenerationResult {
  const category = classifyClientError(error);
  const subject = hop === 'image' ? '概念图生成' : '视觉提取';
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
        ? `${subject}服务请求过于频繁`
        : category === 'timeout'
          ? `${subject}调用超时`
          : `${subject}服务当前不可用`,
  };
}

/**
 * 概念图视觉桥接适配器（SKIN-009）：两跳管线——
 * ① 图像生成客户端依用户描述产概念图；
 * ② 视觉提取客户端读概念图并依据原描述输出 v4 逐像素蓝图
 *    （复用既有 JSON 提取、尺寸/调色板校验、色温守门、拒答判定、
 *      行补丁精修与边界兜底）；
 * ③ 现有确定性渲染器出 PNG，再经 skin-validator 全量校验。
 * 各失败类别映射既有标准错误码，业务层零改动感知 Provider 类型。
 * 生产模式禁止使用（Q-001 基准 ADR 决定前不绑定正式厂商）。
 */
export class ImageConceptSkinProvider {
  readonly #imageClient: ImageClient;
  readonly #visionClient: VisionClient;
  readonly #imageSize: string | undefined;
  readonly #imageTimeoutMs: number | undefined;
  readonly #visionTimeoutMs: number | undefined;

  constructor(options: ImageConceptSkinProviderOptions) {
    if (options.environment === 'production') {
      throw new Error('生产模式禁止使用 ImageConceptSkinProvider（演示适配器，Q-001 未决）');
    }
    this.#imageClient = options.imageClient;
    this.#visionClient = options.visionClient;
    this.#imageSize = options.imageSize;
    this.#imageTimeoutMs = options.imageTimeoutMs;
    this.#visionTimeoutMs = options.visionTimeoutMs;
  }

  get name(): string {
    return 'image-concept';
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const conceptPrompt = [
      '为一名 Minecraft 风格角色绘制全身概念图。',
      `角色描述：${request.prompt}`,
      '要求：单人全身立绘、面向镜头、站姿自然、纯浅灰背景；轮廓、配色与标志性细节清晰可辨；不含文字与水印。',
      `画面只包含这一名角色。`,
    ].join('\n');

    let concept: Awaited<ReturnType<ImageClient['generate']>>;
    try {
      concept = await this.#imageClient.generate({
        prompt: conceptPrompt,
        ...(this.#imageSize ? { size: this.#imageSize } : {}),
        ...(this.#imageTimeoutMs ? { timeoutMs: this.#imageTimeoutMs } : {}),
      });
    } catch (error) {
      return hopFailure('image', error);
    }

    const userPrompt = [
      `皮肤描述：${request.prompt}`,
      `手臂模型：${request.armModel}（4px=Steve 风格，3px=Alex 风格，只影响配色倾向）`,
      `这是本次会话的第 ${request.attempt} 次渲染。`,
      '随本条消息附上一张角色概念图；请严格依据概念图与描述逐像素设计蓝图。',
      '描述中的每个颜色词与服饰词都必须真实出现在最终像素中，并位于正确的身体部位。',
    ].join('\n');

    let draft: SkinDesign | undefined;
    let design: SkinDesign | undefined;
    let lastCompletion: Awaited<ReturnType<VisionClient['extract']>> | undefined;
    let inputUnits = concept.inputUnits;
    let outputUnits = concept.outputUnits;
    let draftPrompt = userPrompt;

    for (let pass = 0; pass < 2; pass += 1) {
      try {
        lastCompletion = await this.#visionClient.extract({
          system: DESIGN_SYSTEM_PROMPT,
          user: draftPrompt,
          image: concept.image,
          ...(this.#visionTimeoutMs ? { timeoutMs: this.#visionTimeoutMs } : {}),
        });
      } catch (error) {
        return hopFailure('vision', error);
      }

      inputUnits += lastCompletion.inputUnits;
      outputUnits += lastCompletion.outputUnits;
      // 先解析、后判拒：思考型模型常在合法 JSON 前加拒答式开场白，
      // 只有在解析不出任何蓝图时才把响应定性为拒答。
      const parsed = parseDraft(lastCompletion.content);
      if (parsed.success) {
        // 与文本直出路线共用同一守门：描述色温与调色板冲突时，
        // 第二次（最后一次）提取机会专门修复调色板——概念图不重画，
        // 只重新读图提取，避免额外图像调用。
        const hueConflict = paletteHueGuard(request.prompt, parsed.design);
        if (hueConflict && pass === 0) {
          draftPrompt = [
            userPrompt,
            '上一份蓝图的调色板与描述色温冲突，请重新读图并修复：',
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
          message: '视觉模型拒绝了该创作描述',
          providerCallId: lastCompletion.providerCallId,
        };
      }
      if (pass === 0) {
        draftPrompt = [
          userPrompt,
          '上一份 JSON 的尺寸或字符协议不合法，请重新读图并修复：',
          parsed.feedback,
        ].join('\n');
      }
    }

    if (!draft) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_INVALID_RESPONSE',
        message: '视觉模型连续两次无法输出合法尺寸的皮肤草图',
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
          lastCompletion = await this.#visionClient.extract({
            system: DETAIL_SYSTEM_PROMPT,
            user: detailPrompt,
            image: concept.image,
            ...(this.#visionTimeoutMs ? { timeoutMs: this.#visionTimeoutMs } : {}),
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
            message: '视觉模型拒绝了该创作描述',
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
        message: '视觉模型草图经过像素精修仍未达到质量门槛',
        ...(lastCompletion ? { providerCallId: lastCompletion.providerCallId } : {}),
      };
    }
    if (!lastCompletion) throw new Error('Vision completion state is unavailable');

    const png = renderSkinDesign(design, { armModel: request.armModel });
    return {
      status: 'succeeded',
      png,
      providerCallId: `img-${concept.providerCallId}:${lastCompletion.providerCallId}`,
      usage: { inputUnits, outputUnits },
      safety: { passed: true, category: 'none' },
    };
  }
}
