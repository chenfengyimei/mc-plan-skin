import { createHash } from 'node:crypto';
import type { ArmModel } from '@mc-plan/skin-core';

/**
 * 厂商无关的生成适配器契约。业务层只依赖本接口，不得引用任何具体厂商的
 * 参数、响应结构或错误文本；正式厂商在基准 ADR（Q-001）决定前不绑定。
 */

export type { ArmModel };

export interface ProviderGenerationRequest {
  /** 结构化前的自然语言创作描述，长度 1..4000。 */
  prompt: string;
  armModel: ArmModel;
  /** 会话内第几次实际渲染（1 起）。 */
  attempt: number;
  /** 跨层关联 ID，用于日志与追踪，不进入厂商请求正文。 */
  correlationId: string;
}

export interface ProviderUsage {
  inputUnits: number;
  outputUnits: number;
}

export interface ProviderSafetyResult {
  passed: boolean;
  category?: 'none' | 'prompt_rejected' | 'output_rejected';
}

export type ProviderErrorCode =
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_CONTENT_REJECTED'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE';

export interface ProviderGenerationSuccess {
  status: 'succeeded';
  /** 候选 PNG 字节（须再经 skin-validator 校验）。 */
  png: Uint8Array;
  /** 提供商调用标识，用于审计与排障。 */
  providerCallId: string;
  usage: ProviderUsage;
  safety: ProviderSafetyResult;
}

export interface ProviderGenerationFailure {
  status: 'failed';
  errorCode: ProviderErrorCode;
  /** 标准化错误摘要；业务逻辑禁止依据消息文本分支。 */
  message: string;
  providerCallId?: string;
}

export type ProviderGenerationResult = ProviderGenerationSuccess | ProviderGenerationFailure;

export interface ProviderAdapter {
  readonly name: string;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}

const RETRYABLE_ERROR_CODES: readonly ProviderErrorCode[] = [
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
];

/** 标准错误分类决定重试策略，不得解析厂商错误文本。 */
export function isRetryableProviderError(errorCode: ProviderErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(errorCode);
}

function assertValidRequest(request: ProviderGenerationRequest): void {
  if (request.prompt.length === 0 || request.prompt.length > 4000) {
    throw new Error('prompt 长度必须在 1..4000 之间');
  }
  if (request.attempt < 1) {
    throw new Error('attempt 必须从 1 开始');
  }
  if (request.correlationId.length === 0) {
    throw new Error('correlationId 不能为空');
  }
}

/**
 * 确定性开发/测试 Fake Provider。
 * - 返回注入的 fixture 字节，使整条链路真实可运行与可测；
 * - 不伪装真实 AI 能力；
 * - 生产环境（SKIN_ENV=production）禁止实例化，防止意外启用。
 * - prompt 含 `[unsafe]` 标记时返回标准内容拒绝错误，用于演练安全路径。
 */
export class FakeProvider implements ProviderAdapter {
  readonly name = 'fake-deterministic';

  constructor(
    private readonly options: {
      resolveFixture: (request: ProviderGenerationRequest) => Promise<Uint8Array>;
      environment: 'development' | 'test' | 'production';
    },
  ) {
    if (options.environment === 'production') {
      throw new Error(
        '生产模式不得启用 Fake Provider：请配置受支持的远程模型适配器（ADR-0009 限制）。',
      );
    }
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    assertValidRequest(request);
    if (request.prompt.includes('[unsafe]')) {
      return {
        status: 'failed',
        errorCode: 'PROVIDER_CONTENT_REJECTED',
        message: '创作描述未通过内容安全检查（Fake Provider 演练路径）',
      };
    }
    const png = await this.options.resolveFixture(request);
    const providerCallId = `fake-${createHash('sha256')
      .update(`${request.armModel}:${request.attempt}:${request.prompt}`)
      .digest('hex')
      .slice(0, 24)}`;
    return {
      status: 'succeeded',
      png,
      providerCallId,
      usage: { inputUnits: request.prompt.length, outputUnits: 1 },
      safety: { passed: true, category: 'none' },
    };
  }
}

export * from './skin-design.js';
export * from './llm-structured-provider.js';
export * from './openai-compat-llm-client.js';
export * from './v4-pipeline.js';
export * from './image-client.js';
export * from './vision-client.js';
