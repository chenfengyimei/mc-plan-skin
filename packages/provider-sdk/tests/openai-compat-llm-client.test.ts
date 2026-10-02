import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LlmClientError } from '../src/llm-structured-provider.js';
import { OpenAiCompatLlmClient } from '../src/openai-compat-llm-client.js';

const okResponse = (body: unknown = { id: 'call-1', choices: [{ message: { content: '{}' } }] }) =>
  new Response(JSON.stringify(body), { status: 200 });

function lastRequestBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatLlmClient', () => {
  it('默认请求体不包含 reasoning_effort，缺少 reasoningEffort 时不改变厂商默认行为', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse()),
    );
    const client = new OpenAiCompatLlmClient({
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'test-key',
      model: 'demo-model',
    });
    const result = await client.complete({ system: 's', user: 'u' });
    expect(result.content).toBe('{}');
    expect(result.providerCallId).toBe('call-1');
    expect(lastRequestBody()).not.toHaveProperty('reasoning_effort');
  });

  it('配置 reasoningEffort 时透传为顶层 reasoning_effort 字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse()),
    );
    const client = new OpenAiCompatLlmClient({
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'test-key',
      model: 'glm-5.3-flash',
      reasoningEffort: 'low',
    });
    await client.complete({ system: 's', user: 'u' });
    const body = lastRequestBody();
    expect(body['reasoning_effort']).toBe('low');
    expect(body['model']).toBe('glm-5.3-flash');
    expect(body['messages']).toHaveLength(2);
  });

  it('HTTP 状态映射为可重试分类：429 限流、408/504 超时、其余不可用', async () => {
    const make = (status: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"error":"x"}', { status })),
      );
      return new OpenAiCompatLlmClient({
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'test-key',
        model: 'demo-model',
      });
    };
    await expect(make(429).complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      category: 'rate_limited',
    } satisfies Partial<LlmClientError>);
    await expect(make(504).complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      category: 'timeout',
    } satisfies Partial<LlmClientError>);
    await expect(make(402).complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      category: 'unavailable',
    } satisfies Partial<LlmClientError>);
  });
});
