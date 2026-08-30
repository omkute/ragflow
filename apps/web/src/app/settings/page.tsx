'use client';
import { PageHeader } from '@/components/page-header';
import {
  Button,
  CodeValue,
  ErrorState,
  Input,
  LoadingSkeleton,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { type AISettings, type HealthResult, api, getApiUrl } from '@/lib/api';
import { useEffect, useState } from 'react';

const embeddingProviders: Array<[AISettings['embeddingProvider'], string]> = [
  ['fake', 'Local deterministic'],
  ['openai', 'OpenAI'],
  ['gemini', 'Google Gemini'],
  ['openai-compatible', 'OpenAI-compatible'],
];
const llmProviders: Array<[AISettings['llmProvider'], string]> = [
  ['fake', 'Local deterministic'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Google Gemini'],
  ['openai-compatible', 'OpenAI-compatible'],
];

export default function Settings() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [ai, setAi] = useState<AISettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embeddingKey, setEmbeddingKey] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    Promise.all([api.health(), api.getAISettings()])
      .then(([h, settings]) => {
        setHealth(h);
        setAi(settings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const save = async () => {
    if (!ai) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await api.updateAISettings({
        embeddingProvider: ai.embeddingProvider,
        embeddingModel: ai.embeddingModel,
        ...(embeddingKey ? { embeddingApiKey: embeddingKey } : {}),
        ...(embeddingBaseUrl ? { embeddingBaseUrl } : {}),
        llmProvider: ai.llmProvider,
        llmModel: ai.llmModel,
        ...(llmKey ? { llmApiKey: llmKey } : {}),
        ...(llmBaseUrl ? { llmBaseUrl } : {}),
      });
      setAi(next);
      setEmbeddingKey('');
      setLlmKey('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure this local Indexa instance and its AI providers."
      />
      <div className="max-w-3xl space-y-6">
        <section className="border border-border p-6">
          <h2 className="font-semibold">Runtime</h2>
          <div className="mt-5 divide-y divide-border">
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-between">
              <span className="text-sm text-muted">API base URL</span>
              <CodeValue copy={getApiUrl()}>{getApiUrl()}</CodeValue>
            </div>
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-between">
              <span className="text-sm text-muted">Supported files</span>
              <span className="font-mono text-xs">.md · .txt</span>
            </div>
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-between">
              <span className="text-sm text-muted">Theme</span>
              <span className="text-sm">Light, dark, or system</span>
            </div>
          </div>
        </section>
        <section className="border border-border p-6">
          <h2 className="font-semibold">AI providers</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Keys are sent only to the local API over this request, kept write-only, and never
            returned to the browser. Anthropic is available for generation; Gemini supports
            generation and embeddings.
          </p>
          {!ai ? (
            <LoadingSkeleton className="mt-5 h-64" />
          ) : (
            <div className="mt-5 space-y-5">
              <ProviderBlock
                title="Embeddings"
                provider={ai.embeddingProvider}
                providers={embeddingProviders}
                model={ai.embeddingModel}
                onProvider={(provider) => setAi({ ...ai, embeddingProvider: provider })}
                onModel={(model) => setAi({ ...ai, embeddingModel: model })}
                keyValue={embeddingKey}
                onKey={setEmbeddingKey}
                baseUrl={embeddingBaseUrl}
                onBaseUrl={setEmbeddingBaseUrl}
                configured={ai.embeddingConfigured}
              />
              <ProviderBlock
                title="Generation"
                provider={ai.llmProvider}
                providers={llmProviders}
                model={ai.llmModel}
                onProvider={(provider) => setAi({ ...ai, llmProvider: provider })}
                onModel={(model) => setAi({ ...ai, llmModel: model })}
                keyValue={llmKey}
                onKey={setLlmKey}
                baseUrl={llmBaseUrl}
                onBaseUrl={setLlmBaseUrl}
                configured={ai.llmConfigured}
              />
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  className="bg-accent text-accent-foreground hover:opacity-90"
                >
                  {saving && <Spinner />}Save provider settings
                </Button>
                {saved && <span className="text-xs text-accent">Saved and active</span>}
              </div>
            </div>
          )}
        </section>
        <section className="border border-border p-6">
          <h2 className="font-semibold">Service health</h2>
          {error ? (
            <div className="mt-4">
              <ErrorState message={error} />
            </div>
          ) : !health ? (
            <LoadingSkeleton className="mt-4 h-36" />
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {Object.entries(health.checks).map(([name, check]) => (
                <div key={name} className="bg-muted/40 p-4">
                  <div className="flex justify-between">
                    <span className="text-sm capitalize">{name}</span>
                    <StatusBadge status={check.status === 'ok' ? 'ready' : 'failed'} />
                  </div>
                  <p className="mt-4 font-mono text-xs text-muted">
                    {check.latencyMs ? `${check.latencyMs} ms` : check.status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="border border-border p-6">
          <h2 className="font-semibold">Local development</h2>
          <pre className="mt-4 overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-6">
            bun run infra:up{`\n`}bun run db:migrate{`\n`}bun run dev:api{`\n`}bun run dev:worker
            {`\n`}bun run dev:web
          </pre>
        </section>
      </div>
    </>
  );
}

function ProviderBlock({
  title,
  provider,
  providers,
  model,
  onProvider,
  onModel,
  keyValue,
  onKey,
  baseUrl,
  onBaseUrl,
  configured,
}: {
  title: string;
  provider: AISettings['embeddingProvider'] | AISettings['llmProvider'];
  providers: Array<[string, string]>;
  model: string;
  onProvider: (value: never) => void;
  onModel: (value: string) => void;
  keyValue: string;
  onKey: (value: string) => void;
  baseUrl: string;
  onBaseUrl: (value: string) => void;
  configured: boolean;
}) {
  return (
    <div className="border-t border-border pt-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {configured && <span className="text-xs text-accent">configured</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium">
          Provider
          <Select
            value={provider}
            onChange={(e) => onProvider(e.target.value as never)}
            className="mt-2 w-full"
          >
            {providers.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-medium">
          Model
          <Input
            value={model}
            onChange={(e) => onModel(e.target.value)}
            className="mt-2 font-mono text-xs"
          />
        </label>
      </div>
      <label className="mt-4 block text-xs font-medium">
        API key
        <Input
          type="password"
          value={keyValue}
          onChange={(e) => onKey(e.target.value)}
          className="mt-2 font-mono text-xs"
          placeholder={configured ? 'Saved · enter a new key to replace it' : 'Paste provider key'}
          autoComplete="off"
        />
      </label>
      {provider === 'openai-compatible' && (
        <label className="mt-4 block text-xs font-medium">
          Base URL
          <Input
            value={baseUrl}
            onChange={(e) => onBaseUrl(e.target.value)}
            className="mt-2 font-mono text-xs"
            placeholder="https://api.groq.com/openai/v1"
          />
        </label>
      )}
    </div>
  );
}
