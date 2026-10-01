import { describe, expect, it } from 'vitest';
import { FakeProvider, isRetryableProviderError } from '../src/index.js';
import type { ProviderGenerationRequest } from '../src/index.js';

function baseRequest(
  overrides: Partial<ProviderGenerationRequest> = {},
): ProviderGenerationRequest {
  return {
    prompt: '一位戴着蓝色围巾的雪地探险家',
    armModel: 'steve',
    attempt: 1,
    correlationId: 'corr-1',
    ...overrides,
  };
}

const fixtureBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function makeProvider(environment: 'development' | 'test' = 'development') {
  return new FakeProvider({
    environment,
    resolveFixture: async () => fixtureBytes,
  });
}

describe('FakeProvider', () => {
  it('生产模式实例化被拒绝', () => {
    expect(
      () =>
        new FakeProvider({
          environment: 'production',
          resolveFixture: async () => fixtureBytes,
        }),
    ).toThrow(/生产模式不得启用 Fake Provider/);
  });

  it('正常请求返回成功结果与注入的 fixture 字节', async () => {
    const provider = await makeProvider();
    const result = await provider.generate(baseRequest());
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.png).toEqual(fixtureBytes);
      expect(result.usage.inputUnits).toBe(baseRequest().prompt.length);
      expect(result.usage.outputUnits).toBe(1);
      expect(result.safety.passed).toBe(true);
      expect(result.providerCallId).toMatch(/^fake-[0-9a-f]{24}$/);
    }
  });

  it('相同请求产生确定性的调用 ID 与字节', async () => {
    const provider = await makeProvider();
    const first = await provider.generate(baseRequest());
    const second = await provider.generate(baseRequest());
    if (first.status === 'succeeded' && second.status === 'succeeded') {
      expect(first.providerCallId).toBe(second.providerCallId);
      expect([...first.png]).toEqual([...second.png]);
    } else {
      expect.unreachable('相同请求应当成功');
    }
  });

  it('不同 armModel 或 attempt 产生不同调用 ID', async () => {
    const provider = await makeProvider();
    const steve = await provider.generate(baseRequest({ armModel: 'steve' }));
    const alex = await provider.generate(baseRequest({ armModel: 'alex' }));
    if (steve.status === 'succeeded' && alex.status === 'succeeded') {
      expect(steve.providerCallId).not.toBe(alex.providerCallId);
    }
  });

  it('包含 [unsafe] 标记的请求返回标准内容拒绝错误', async () => {
    const provider = await makeProvider();
    const result = await provider.generate(baseRequest({ prompt: '画出 [unsafe] 内容' }));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('PROVIDER_CONTENT_REJECTED');
      expect(isRetryableProviderError(result.errorCode)).toBe(false);
    }
  });

  it('非法请求（空 prompt、非正 attempt、空关联 ID）被拒绝', async () => {
    const provider = await makeProvider();
    await expect(provider.generate(baseRequest({ prompt: '' }))).rejects.toThrow(/prompt/);
    await expect(provider.generate(baseRequest({ attempt: 0 }))).rejects.toThrow(/attempt/);
    await expect(provider.generate(baseRequest({ correlationId: '' }))).rejects.toThrow(
      /correlationId/,
    );
  });
});

describe('标准错误分类', () => {
  it('限流、无效响应、超时与不可用可重试；内容拒绝不可重试', () => {
    expect(isRetryableProviderError('PROVIDER_RATE_LIMITED')).toBe(true);
    expect(isRetryableProviderError('PROVIDER_INVALID_RESPONSE')).toBe(true);
    expect(isRetryableProviderError('PROVIDER_TIMEOUT')).toBe(true);
    expect(isRetryableProviderError('PROVIDER_UNAVAILABLE')).toBe(true);
    expect(isRetryableProviderError('PROVIDER_CONTENT_REJECTED')).toBe(false);
  });
});
