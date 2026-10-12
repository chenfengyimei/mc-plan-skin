import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LlmClientError } from '../src/llm-structured-provider.js';
import { FixedVisionClient, OpenAiCompatVisionClient } from '../src/vision-client.js';

const IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);

const okResponse = () =>
  new Response(
    JSON.stringify({
      id: 'vision-call-1',
      choices: [{ message: { content: '{"version":4}' } }],
      usage: { prompt_tokens: 4321, completion_tokens: 21 },
    }),
    { status: 200 },
  );

function lastRequest(): { url: string; body: Record<string, unknown> } {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return {
    url: String(call?.[0]),
    body: JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatVisionClient', () => {
  it('以 OpenAI 兼容消息体携带文本与图像内容段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse()),
    );
    const client = new OpenAiCompatVisionClient({
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'test-key',
      model: 'vision-model-y',
      reasoningEffort: 'low',
    });
    const result = await client.extract({
      system: '系统提示',
      user: '读取概念图并输出蓝图',
      image: IMAGE,
    });
    expect(result.content).toBe('{"version":4}');
    expect(result.providerCallId).toBe('vision-call-1');
    expect(result.inputUnits).toBe(4321);
    expect(result.outputUnits).toBe(21);

    const { url, body } = lastRequest();
    expect(url).toBe('https://llm.example.invalid/v1/chat/completions');
    expect(body['model']).toBe('vision-model-y');
    expect(body['reasoning_effort']).toBe('low');
    const messages = body['messages'] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'system', content: '系统提示' });
    const content = messages[1]!['content'] as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: 'text', text: '读取概念图并输出蓝图' });
    expect(content[1]!['type']).toBe('image_url');
    const imageUrl = (content[1]!['image_url'] as { url: string }).url;
    expect(imageUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('HTTP 状态映射标准类别：429 限流、408 超时、401 不可用', async () => {
    const make = (status: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"error":"x"}', { status })),
      );
      return new OpenAiCompatVisionClient({
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'test-key',
        model: 'vision-model-y',
      });
    };
    await expect(make(429).extract({ system: 's', user: 'u', image: IMAGE })).rejects.toMatchObject(
      { category: 'rate_limited' } satisfies Partial<LlmClientError>,
    );
    await expect(make(408).extract({ system: 's', user: 'u', image: IMAGE })).rejects.toMatchObject(
      { category: 'timeout' } satisfies Partial<LlmClientError>,
    );
    await expect(make(401).extract({ system: 's', user: 'u', image: IMAGE })).rejects.toMatchObject(
      { category: 'unavailable' } satisfies Partial<LlmClientError>,
    );
  });
});

describe('FixedVisionClient（演示/测试注入点）', () => {
  it('返回固定蓝图文本且字节确定', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fixed-vision-'));
    const path = join(dir, 'blueprint.json');
    await writeFile(path, '{"version":4,"palette":{}}', 'utf8');
    try {
      const client = new FixedVisionClient({ path });
      const first = await client.extract({ system: 's', user: 'u', image: IMAGE });
      const second = await client.extract({ system: 's', user: 'u', image: IMAGE });
      expect(first.content).toBe('{"version":4,"palette":{}}');
      expect(second.content).toBe(first.content);
      expect(first.providerCallId).toBe('fixed-vision-blueprint.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
