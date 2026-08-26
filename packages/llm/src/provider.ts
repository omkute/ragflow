/**
 * Provider abstraction for LLM generation.
 * Keeps HTTP/queue/indexing layers independent from vendor SDKs.
 */
export interface LLMProvider {
  generate(input: { system?: string; prompt: string }): Promise<string>;
}
