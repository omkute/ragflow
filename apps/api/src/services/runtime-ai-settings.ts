import { GeminiEmbeddingProvider, OpenAIEmbeddingProvider } from '@indexa/embeddings';
import type { EmbeddingProvider } from '@indexa/embeddings';
import { AnthropicLLMProvider, GeminiLLMProvider, OpenAILLMProvider } from '@indexa/llm';
import type { LLMProvider } from '@indexa/llm';

export type RuntimeProvider = 'fake' | 'openai' | 'gemini' | 'anthropic' | 'openai-compatible';

export interface RuntimeAISettings {
  embeddingProvider: RuntimeProvider;
  embeddingModel: string;
  embeddingConfigured: boolean;
  llmProvider: RuntimeProvider;
  llmModel: string;
  llmConfigured: boolean;
}

export class RuntimeEmbeddingProvider implements EmbeddingProvider {
  private provider: EmbeddingProvider;
  private readonly fallback: EmbeddingProvider;
  private settings: RuntimeAISettings;
  private embeddingKey: string | undefined;

  constructor(provider: EmbeddingProvider, settings: RuntimeAISettings, embeddingKey?: string) {
    this.provider = provider;
    this.fallback = provider;
    this.settings = settings;
    this.embeddingKey = embeddingKey;
  }

  configure(input: {
    provider: RuntimeProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }): void {
    this.settings.embeddingProvider = input.provider;
    this.settings.embeddingModel = input.model;
    this.embeddingKey = input.apiKey ?? this.embeddingKey;
    if (input.provider === 'fake') {
      this.provider = this.fallback;
      return;
    }
    if (input.provider === 'openai' || input.provider === 'openai-compatible') {
      if (!this.embeddingKey) throw new Error('An OpenAI embedding API key is required');
      this.provider = new OpenAIEmbeddingProvider({
        apiKey: this.embeddingKey,
        model: input.model,
        dimension: 1536,
        baseUrl: input.baseUrl,
      });
    } else if (input.provider === 'gemini') {
      if (!this.embeddingKey) throw new Error('A Gemini API key is required');
      this.provider = new GeminiEmbeddingProvider({
        apiKey: this.embeddingKey,
        model: input.model,
        dimension: 1536,
        baseUrl: input.baseUrl,
      });
    } else if (input.provider === 'anthropic') {
      throw new Error('Anthropic does not provide an embeddings API');
    }
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }
  embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }
  getSettings(): RuntimeAISettings {
    return {
      ...this.settings,
      embeddingConfigured: Boolean(this.embeddingKey) || this.settings.embeddingProvider === 'fake',
    };
  }
}

export class RuntimeLLMProvider implements LLMProvider {
  private provider: LLMProvider;
  private readonly fallback: LLMProvider;
  private settings: RuntimeAISettings;
  private llmKey: string | undefined;

  constructor(provider: LLMProvider, settings: RuntimeAISettings, llmKey?: string) {
    this.provider = provider;
    this.fallback = provider;
    this.settings = settings;
    this.llmKey = llmKey;
  }

  configure(input: {
    provider: RuntimeProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }): void {
    this.settings.llmProvider = input.provider;
    this.settings.llmModel = input.model;
    this.llmKey = input.apiKey ?? this.llmKey;
    if (input.provider === 'fake') {
      this.provider = this.fallback;
      return;
    }
    if (input.provider === 'openai' || input.provider === 'openai-compatible') {
      if (!this.llmKey) throw new Error('An OpenAI generation API key is required');
      this.provider = new OpenAILLMProvider({
        apiKey: this.llmKey,
        model: input.model,
        baseUrl: input.baseUrl,
      });
    } else if (input.provider === 'anthropic') {
      if (!this.llmKey) throw new Error('An Anthropic API key is required');
      this.provider = new AnthropicLLMProvider({
        apiKey: this.llmKey,
        model: input.model,
        baseUrl: input.baseUrl,
      });
    } else if (input.provider === 'gemini') {
      if (!this.llmKey) throw new Error('A Gemini API key is required');
      this.provider = new GeminiLLMProvider({
        apiKey: this.llmKey,
        model: input.model,
        baseUrl: input.baseUrl,
      });
    }
  }

  generate(input: { system?: string; prompt: string }): Promise<string> {
    return this.provider.generate(input);
  }
  getSettings(): RuntimeAISettings {
    return {
      ...this.settings,
      llmConfigured: Boolean(this.llmKey) || this.settings.llmProvider === 'fake',
    };
  }
}
