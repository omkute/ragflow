import type { LLMProvider } from './provider';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

export class GeminiLLMProvider implements LLMProvider {
  constructor(private readonly options: { apiKey: string; model: string; baseUrl?: string }) {}

  async generate(input: { system?: string; prompt: string }): Promise<string> {
    const contents = [{ role: 'user', parts: [{ text: input.prompt }] }];
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'}/models/${this.options.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
          contents,
        }),
      },
    );
    const payload = (await response.json()) as GeminiResponse;
    if (!response.ok)
      throw new Error(payload.error?.message ?? `Gemini request failed (${response.status})`);
    const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!answer) throw new Error('Gemini returned an empty answer');
    return answer;
  }
}
