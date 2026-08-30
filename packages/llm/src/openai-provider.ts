import type { LLMProvider } from './provider';

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(private readonly options: { apiKey: string; model: string; baseUrl?: string }) {}

  async generate(input: { system?: string; prompt: string }): Promise<string> {
    const messages = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      { role: 'user', content: input.prompt },
    ];
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.options.model, messages }),
      },
    );
    const payload = (await response.json()) as OpenAIChatResponse;
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? `OpenAI generation request failed (${response.status})`,
      );
    const answer = payload.choices?.[0]?.message?.content;
    if (!answer) throw new Error('OpenAI returned an empty answer');
    return answer;
  }
}
