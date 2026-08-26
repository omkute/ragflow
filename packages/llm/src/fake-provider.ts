import type { LLMProvider } from './provider';

/**
 * Deterministic fake LLM provider for tests and local dev.
 *
 * - No external I/O, no API keys.
 * - Returns a reproducible answer that echoes the prompt's question and
 *   cites the provided context length, so generation tests can assert on
 *   citations without relying on a real model.
 * - Tracks calls for assertions.
 */
export class FakeLLMProvider implements LLMProvider {
  calls = 0;
  callsLog: Array<{ system?: string; prompt: string }> = [];

  async generate(input: { system?: string; prompt: string }): Promise<string> {
    this.calls += 1;
    this.callsLog.push({ system: input.system, prompt: input.prompt });

    // Extract question line if present: "Question: <query>"
    const questionMatch = /Question:\s*(.+)/i.exec(input.prompt);
    const question = questionMatch?.[1]?.trim() ?? 'your question';

    // Count context chunks by "[n]" markers if present
    const contextCount = (input.prompt.match(/\[\d+\]/g) ?? []).length;

    if (contextCount === 0) {
      return `I could not find relevant documents to answer "${question}".`;
    }

    return `Answer to "${question}" based on ${contextCount} retrieved chunk(s). This is a synthetic answer from FakeLLMProvider. Citations: ${Array.from({ length: contextCount }, (_, i) => `[${i + 1}]`).join(', ')}.`;
  }

  reset(): void {
    this.calls = 0;
    this.callsLog = [];
  }
}
