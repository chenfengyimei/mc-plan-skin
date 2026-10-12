import { readFile } from 'node:fs/promises';

/**
 * 厂商中立的图像生成客户端抽象（SKIN-009 概念桥接第一跳）。
 * 与 LlmClient 同构：注入式设计、可离线 mock，传输错误以标准类别抛出，
 * 业务层只认 ProviderErrorCode，不解析任何厂商文本。
 */
export interface ImageClient {
  generate(options: {
    /** 概念图生成提示词（由适配器从用户描述构造，不含密钥与关联 ID）。 */
    prompt: string;
    /** 可选尺寸（如 1024x1024）；不设则使用厂商默认。 */
    size?: string;
    timeoutMs?: number;
  }): Promise<{
    /** 概念图字节（由视觉提取通道消费，不直接作为皮肤输出）。 */
    image: Uint8Array;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }>;
}

export class ImageClientError extends Error {
  constructor(
    readonly category: 'rate_limited' | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ImageClientError';
  }
}

/** OpenAI 兼容 images/generations 客户端（LiteLLM 中继、各厂商兼容端点均可）。 */
export class OpenAiCompatImageClient implements ImageClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      defaultTimeoutMs?: number;
    },
  ) {}

  async generate(options: {
    prompt: string;
    size?: string;
    timeoutMs?: number;
  }): Promise<{
    image: Uint8Array;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }> {
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 120_000;
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt: options.prompt,
        n: 1,
        ...(options.size ? { size: options.size } : {}),
        response_format: 'b64_json',
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
      throw new ImageClientError(category, `图像服务 HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      created?: number;
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const entry = json.data?.[0];
    if (entry?.b64_json) {
      const bytes = Buffer.from(entry.b64_json, 'base64');
      return {
        image: new Uint8Array(bytes),
        providerCallId: `image-${json.created ?? 'unknown'}`,
        inputUnits: options.prompt.length,
        outputUnits: bytes.byteLength,
      };
    }
    // 部分兼容端点只返回 url：补一次显式下载（仍然厂商中立）。
    if (entry?.url) {
      const download = await fetch(entry.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!download.ok) {
        throw new ImageClientError('unavailable', `概念图下载 HTTP ${download.status}`);
      }
      const bytes = new Uint8Array(await download.arrayBuffer());
      return {
        image: bytes,
        providerCallId: `image-${json.created ?? 'unknown'}`,
        inputUnits: options.prompt.length,
        outputUnits: bytes.byteLength,
      };
    }
    throw new ImageClientError('unavailable', '图像响应中没有 b64_json 或 url');
  }
}

/**
 * 固定概念图客户端：显式标注的演示/测试注入点（SKIN_IMAGE_FIXTURE_PATH）。
 * 逐次读取文件并缓存，同一文件字节确定；不发起任何网络调用。
 */
export class FixedImageClient implements ImageClient {
  readonly #path: string;
  #cache?: Uint8Array;

  constructor(options: { path: string }) {
    this.#path = options.path;
  }

  async generate(options: { prompt: string; size?: string; timeoutMs?: number }): Promise<{
    image: Uint8Array;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }> {
    if (!this.#cache) {
      this.#cache = new Uint8Array(await readFile(this.#path));
    }
    void options;
    return {
      image: this.#cache,
      providerCallId: `fixed-image-${this.#path.split('/').pop() ?? 'fixture'}`,
      inputUnits: options.prompt.length,
      outputUnits: 1,
    };
  }
}
