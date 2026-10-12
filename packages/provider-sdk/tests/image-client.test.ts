import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ImageClientError } from '../src/image-client.js';
import { FixedImageClient, OpenAiCompatImageClient } from '../src/image-client.js';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);

const b64Response = () =>
  new Response(
    JSON.stringify({
      created: 1_700_000_000,
      data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }],
    }),
    { status: 200 },
  );

function lastRequestBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatImageClient', () => {
  it('请求 images/generations 并解码 b64_json 概念图字节', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => b64Response()));
    const client = new OpenAiCompatImageClient({
      baseUrl: 'https://image.example.invalid/v1',
      apiKey: 'test-key',
      model: 'image-model-x',
    });
    const result = await client.generate({ prompt: '雪地探险家概念图' });
    expect([...result.image]).toEqual([...PNG_BYTES]);
    expect(result.providerCallId).toBe('image-1700000000');
    expect(result.inputUnits).toBe('雪地探险家概念图'.length);

    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(String(call?.[0])).toBe('https://image.example.invalid/v1/images/generations');
    const body = lastRequestBody();
    expect(body['model']).toBe('image-model-x');
    expect(body['response_format']).toBe('b64_json');
    expect(body['n']).toBe(1);
    expect(body).not.toHaveProperty('size');
  });

  it('可选 size 透传为请求体字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => b64Response()));
    const client = new OpenAiCompatImageClient({
      baseUrl: 'https://image.example.invalid/v1',
      apiKey: 'test-key',
      model: 'image-model-x',
    });
    await client.generate({ prompt: 'p', size: '1024x1024' });
    expect(lastRequestBody()['size']).toBe('1024x1024');
  });

  it('HTTP 状态映射标准类别：429 限流、504 超时、其余不可用', async () => {
    const make = (status: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"error":"x"}', { status })),
      );
      return new OpenAiCompatImageClient({
        baseUrl: 'https://image.example.invalid/v1',
        apiKey: 'test-key',
        model: 'image-model-x',
      });
    };
    await expect(make(429).generate({ prompt: 'p' })).rejects.toMatchObject({
      category: 'rate_limited',
    } satisfies Partial<ImageClientError>);
    await expect(make(504).generate({ prompt: 'p' })).rejects.toMatchObject({
      category: 'timeout',
    } satisfies Partial<ImageClientError>);
    await expect(make(500).generate({ prompt: 'p' })).rejects.toMatchObject({
      category: 'unavailable',
    } satisfies Partial<ImageClientError>);
  });

  it('只有 url 的兼容端点走显式下载并映射下载失败为不可用', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input?: RequestInfo | URL) => {
        if (String(input).includes('/images/generations')) {
          return new Response(
            JSON.stringify({ created: 7, data: [{ url: 'https://cdn.example.invalid/concept.png' }] }),
            { status: 200 },
          );
        }
        return new Response(new Uint8Array(PNG_BYTES), { status: 200 });
      }),
    );
    const client = new OpenAiCompatImageClient({
      baseUrl: 'https://image.example.invalid/v1',
      apiKey: 'test-key',
      model: 'image-model-x',
    });
    const result = await client.generate({ prompt: 'p' });
    expect([...result.image]).toEqual([...PNG_BYTES]);
  });

  it('响应缺 b64_json 与 url 时归类不可用而不是抛厂商文本', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ created: 9, data: [{}] }), { status: 200 })),
    );
    const client = new OpenAiCompatImageClient({
      baseUrl: 'https://image.example.invalid/v1',
      apiKey: 'test-key',
      model: 'image-model-x',
    });
    await expect(client.generate({ prompt: 'p' })).rejects.toMatchObject({
      category: 'unavailable',
    } satisfies Partial<ImageClientError>);
  });
});

describe('FixedImageClient（演示/测试注入点）', () => {
  it('读取固定文件且字节确定、不发起网络调用', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fixed-image-'));
    const path = join(dir, 'concept.png');
    await writeFile(path, PNG_BYTES);
    try {
      const client = new FixedImageClient({ path });
      const first = await client.generate({ prompt: 'p' });
      const second = await client.generate({ prompt: 'p' });
      expect([...first.image]).toEqual([...PNG_BYTES]);
      expect([...second.image]).toEqual([...first.image]);
      expect(first.providerCallId).toBe('fixed-image-concept.png');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
