import type { LlmClient } from './llm-structured-provider.js';

/** OpenAI 兼容 chat/completions 客户端（LiteLLM 中继、各厂商兼容端点均可）。 */
export class OpenAiCompatLlmClient implements LlmClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      defaultTimeoutMs?: number;
    },
  ) {}

  async complete(options: { system: string; user: string; timeoutMs?: number }): Promise<{
    content: string;
    providerCallId: string;
    inputUnits: number;
    outputUnits: number;
  }> {
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
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
          { role: 'user', content: options.user },
        ],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}`);
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
