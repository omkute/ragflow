import type { LLMProvider } from './provider';

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export class AnthropicLLMProvider implements LLMProvider {
  constructor(private readonly options: { apiKey: string; model: string; baseUrl?: string }) {}

  async generate(input: { system?: string; prompt: string }): Promise<string> {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: 2048,
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: 'user', content: input.prompt }],
        }),
      },
    );
    const payload = (await response.json()) as AnthropicResponse;
    if (!response.ok)
      throw new Error(payload.error?.message ?? `Anthropic request failed (${response.status})`);
    const answer = payload.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('');
    if (!answer) throw new Error('Anthropic returned an empty answer');
    return answer;
  }
}
