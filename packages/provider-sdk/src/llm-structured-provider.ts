import {
  enrichSkinDesignDraft,
  renderSkinDesign,
  type SkinDesign,
} from './skin-design.js';
import type { ProviderGenerationRequest, ProviderGenerationResult } from './index.js';
import {
  applyRowPatches,
  classifyClientError,
  DESIGN_SYSTEM_PROMPT,
  designFeedback,
  looksLikeRefusal,
  parseDraft,
  paletteHueGuard,
  DETAIL_SYSTEM_PROMPT,
} from './v4-pipeline.js';

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

function providerFailure(error: unknown): ProviderGenerationResult {
  const category = classifyClientError(error);
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
