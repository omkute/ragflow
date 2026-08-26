import { describe, expect, test } from 'bun:test';
import { FakeLLMProvider } from '../src/fake-provider';

describe('FakeLLMProvider', () => {
  test('generates deterministic answer containing question and citation markers', async () => {
    const provider = new FakeLLMProvider();
    const prompt = 'Context:\n[1] hello world\n\nQuestion: what is hello?\n\nProvide an answer';
    const answer = await provider.generate({ prompt });
    expect(answer).toContain('what is hello?');
    expect(answer).toContain('[1]');
    expect(provider.calls).toBe(1);
  });

  test('returns no-context message when prompt has no markers', async () => {
    const provider = new FakeLLMProvider();
    const prompt = 'Context:\nNo relevant context found.\n\nQuestion: anything\n\nProvide';
    const answer = await provider.generate({ prompt });
    expect(answer).toContain('could not find relevant documents');
  });

  test('tracks calls and resets', async () => {
    const provider = new FakeLLMProvider();
    await provider.generate({ prompt: 'Question: hi' });
    expect(provider.calls).toBe(1);
    expect(provider.callsLog[0]?.prompt).toContain('hi');
    provider.reset();
    expect(provider.calls).toBe(0);
    expect(provider.callsLog.length).toBe(0);
  });
});
