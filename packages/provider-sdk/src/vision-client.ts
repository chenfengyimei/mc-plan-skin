import { readFile } from 'node:fs/promises';

import { LlmClientError, type LlmClient } from './llm-structured-provider.js';

/**
 * 视觉提取客户端抽象（SKIN-009 概念桥接第二跳）：图像 + 文本 → 结构化文本。
 * 与 LlmClient 同构（同一传输错误类别、同样的用量/调用 ID 形态），但消息体
 * 携带图像内容段；实现不绑定具体厂商（OpenAI 兼容消息形状）。
 */
export interface VisionClient {
  extract(options: {
    system: string;
    user: string;
    /** 概念图字节（PNG 等），以数据 URL 段随消息体发送。 */
    image: Uint8Array;
    imageMediaType?: string;
    timeoutMs?: number;
  }): Promise<{ content: string; providerCallId: string; inputUnits: number; outputUnits: number }>;
}

function imageDataUrl(image: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(image).toString('base64')}`;
}

/** OpenAI 兼容 chat/completions 视觉客户端：消息体携带图像内容段。 */
export class OpenAiCompatVisionClient implements VisionClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      defaultTimeoutMs?: number;
      /** OpenAI o 系列同名的推理力度透传；思考型模型用它控制思考深度。 */
      reasoningEffort?: string;
    },
  ) {}

  async extract(options: {
    system: string;
    user: string;
    image: Uint8Array;
    imageMediaType?: string;
    timeoutMs?: number;
  }): Promise<{
    content: string;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }> {
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
    const mediaType = options.imageMediaType ?? 'image/png';
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: options.system },
          {
            role: 'user',
            content: [
              { type: 'text', text: options.user },
              { type: 'image_url', image_url: { url: imageDataUrl(options.image, mediaType) } },
            ],
          },
        ],
        temperature: 0.4,
        ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const category =
        response.status === 429
          ? 'rate_limited'
          : response.status === 408 || response.status === 504
            ? 'timeout'
            : 'unavailable';
      throw new LlmClientError(category, `视觉服务 HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    return {
      content,
      providerCallId: json.id ?? 'unknown',
      inputUnits: json.usage?.prompt_tokens ?? 0,
      outputUnits: json.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * 固定视觉客户端：显式标注的演示/测试注入点（SKIN_VISION_FIXTURE_PATH）。
 * 返回固定文本（蓝图 JSON fixture）；忽略图像输入但仍要求调用方传入
 * （保持真实调用形态，使固定模式下的管线行为与真实模式一致）。
 */
export class FixedVisionClient implements VisionClient {
  readonly #path: string;
  #cache?: string;

  constructor(options: { path: string }) {
    this.#path = options.path;
  }

  async extract(options: {
    system: string;
    user: string;
    image: Uint8Array;
    imageMediaType?: string;
    timeoutMs?: number;
  }): Promise<{
    content: string;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }> {
    if (!this.#cache) {
      this.#cache = await readFile(this.#path, 'utf8');
    }
    void options;
    return {
      content: this.#cache,
      providerCallId: `fixed-vision-${this.#path.split('/').pop() ?? 'fixture'}`,
      inputUnits: this.#cache.length,
      outputUnits: 1,
    };
  }
}

/** 便于既有 LlmClient mock 复用的类型别名：视觉客户端与 Llm 客户端共享完成形态。 */
export type VisionCompletion = Awaited<ReturnType<LlmClient['complete']>>;
