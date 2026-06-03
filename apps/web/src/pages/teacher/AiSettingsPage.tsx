import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';
import {
  useLlmModels,
  recommendedChatModel,
  recommendedEmbeddingModel,
  type ChatModelSpec,
  type EmbeddingModelSpec,
} from '../../lib/llm/useLlmModels';

interface LlmSettings {
  provider: string | null;
  model: string | null;
  embeddingModel: string | null;
  hasKey: boolean;
  // Stage 04 (RAG) — separate Cohere Rerank key flag. The server
  // never returns the (encrypted) key itself; this is presence-only
  // so the panel can render "configured" / "not configured" without
  // leaking secrets back to the browser.
  hasCohereKey?: boolean;
}

type ProviderKey = 'openai' | 'gemini';

const PROVIDER_KEY_HELP: Record<ProviderKey, { placeholder: string; url: string; label: string }> = {
  openai: {
    placeholder: 'sk-...',
    url: 'https://platform.openai.com/api-keys',
    label: 'platform.openai.com/api-keys',
  },
  gemini: {
    placeholder: 'AIza...',
    url: 'https://aistudio.google.com/apikey',
    label: 'aistudio.google.com/apikey',
  },
};

export function AiSettingsPage() {
  const { toast } = useToast();

  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState<ProviderKey>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Stage 04 (RAG) — Cohere Rerank key state. Independent from the
  // chat-LLM key above because Cohere is a separate vendor: the
  // teacher can opt in to reranking without touching their chat
  // credentials, and revoking Cohere doesn't affect chat.
  const [cohereKey, setCohereKey] = useState('');
  const [savingCohere, setSavingCohere] = useState(false);
  const [showCohereKey, setShowCohereKey] = useState(false);

  // Stage 2 LLM upgrade: every option in the dropdowns now comes from
  // the server-side registry (`/llm/models`). No more hard-coded lists
  // here — when Stage 1's registry adds/retires a model, this page
  // reflects it on next mount.
  const { models, loading: modelsLoading, error: modelsError } = useLlmModels();

  const chatOptionsForProvider = useMemo<ChatModelSpec[]>(
    () => models?.chat.filter((m) => m.provider === provider) ?? [],
    [models, provider],
  );
  const embeddingOptionsForProvider = useMemo<EmbeddingModelSpec[]>(
    () => models?.embedding.filter((m) => m.provider === provider) ?? [],
    [models, provider],
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<LlmSettings>('/llm-settings');
        setSettings(data);
        if (data.provider === 'openai' || data.provider === 'gemini') {
          setProvider(data.provider);
        }
        if (data.model) setModel(data.model);
        if (data.embeddingModel) setEmbeddingModel(data.embeddingModel);
      } catch {
        toast('error', 'Failed to load AI settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After the registry has loaded, ensure the local model/embeddingModel
  // state references a model the new provider actually offers. We only
  // fill these from the registry when we don't already have a value from
  // the persisted settings (so the user's existing — possibly
  // deprecated — choice survives the initial load and shows up with the
  // "legacy" badge below).
  useEffect(() => {
    if (!models) return;
    if (!model) {
      const rec = recommendedChatModel(models, provider);
      if (rec) setModel(rec.id);
    }
    if (!embeddingModel) {
      const rec = recommendedEmbeddingModel(models, provider);
      if (rec) setEmbeddingModel(rec.id);
    }
  }, [models, provider, model, embeddingModel]);

  const handleProviderChange = (next: ProviderKey) => {
    setProvider(next);
    // Reset the model selections to recommended defaults for the new
    // provider — leaving the previous provider's model id selected would
    // submit a mismatched-provider payload that the server rejects.
    const recChat = recommendedChatModel(models, next);
    setModel(recChat?.id ?? '');
    const recEmbed = recommendedEmbeddingModel(models, next);
    setEmbeddingModel(recEmbed?.id ?? '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/llm-settings', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey, model, embeddingModel }),
      });
      toast('success', 'API key saved');
      setApiKey('');
      // Refresh settings
      const data = await apiFetch<LlmSettings>('/llm-settings');
      setSettings(data);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove your API key? AI features will use template mode.')) return;
    try {
      await apiFetch('/llm-settings', { method: 'DELETE' });
      toast('success', 'API key removed');
      setSettings({ provider: null, model: null, embeddingModel: null, hasKey: false });
      setApiKey('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  // Stage 04 (RAG) — save / remove the Cohere Rerank key. Same
  // pattern as the chat-LLM key above: server-side encryption with
  // AES-256-GCM, presence-only readback via `hasCohereKey`.
  const handleSaveCohere = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cohereKey.trim()) {
      toast('error', 'Enter a Cohere API key');
      return;
    }
    setSavingCohere(true);
    try {
      await apiFetch('/llm-settings/cohere', {
        method: 'POST',
        body: JSON.stringify({ apiKey: cohereKey }),
      });
      toast('success', 'Cohere API key saved');
      setCohereKey('');
      const data = await apiFetch<LlmSettings>('/llm-settings');
      setSettings(data);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save Cohere key');
    } finally {
      setSavingCohere(false);
    }
  };

  const handleRemoveCohere = async () => {
    if (!confirm('Remove your Cohere key? Reranking will fall back to RRF order.')) return;
    try {
      await apiFetch('/llm-settings/cohere', { method: 'DELETE' });
      toast('success', 'Cohere key removed');
      const data = await apiFetch<LlmSettings>('/llm-settings');
      setSettings(data);
      setCohereKey('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to remove Cohere key');
    }
  };

  // Detect saved chat model that the registry no longer offers (or marks
  // deprecated). Render a non-blocking banner — the spec says don't yank
  // the option out from under the teacher, just warn and suggest the
  // recommended replacement.
  const savedChatSpec = models?.chat.find((m) => m.id === (settings?.model ?? ''));
  const recommendedChatForBanner = recommendedChatModel(models, provider);
  const showRetiredChatBanner =
    !!settings?.model &&
    !!models &&
    (!savedChatSpec || savedChatSpec.deprecated === true);

  if (loading) {
    return <div className="text-gray-500">Loading AI settings...</div>;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Settings</h2>
      <p className="text-sm text-gray-500 mb-6">
        Configure your AI provider API key to enable AI-powered content generation and learning
        strategies. Your key is encrypted at rest and only used for your requests.
      </p>

      {/* Current Status */}
      <div
        className={`p-4 rounded-lg border mb-6 ${
          settings?.hasKey
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              settings?.hasKey ? 'bg-green-500' : 'bg-yellow-500'
            }`}
          />
          <span
            className={`text-sm font-medium ${
              settings?.hasKey ? 'text-green-800' : 'text-yellow-800'
            }`}
          >
            {settings?.hasKey
              ? `Connected - ${settings.provider ?? 'openai'} / ${settings.model ?? '(default)'}`
              : 'Not configured - using template mode (no AI)'}
          </span>
        </div>
        {!settings?.hasKey && (
          <p className="text-xs text-yellow-700 mt-2">
            Without an API key, the Course Studio will use template-based content generation.
            To use real AI, enter your API key below.
          </p>
        )}
      </div>

      {/* Retired-model banner — non-blocking, suggests recommended replacement. */}
      {showRetiredChatBanner && (
        <div className="p-4 rounded-lg border bg-amber-50 border-amber-200 mb-6">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Heads up:</span> your selected chat model{' '}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">{settings?.model}</code>{' '}
            is{' '}
            {savedChatSpec ? 'a legacy / deprecated model' : 'no longer offered'}
            {recommendedChatForBanner ? (
              <>
                {' '}— consider switching to{' '}
                <code className="font-mono text-xs bg-amber-100 px-1 rounded">
                  {recommendedChatForBanner.id}
                </code>{' '}
                ({recommendedChatForBanner.label}).
              </>
            ) : (
              '.'
            )}
          </p>
        </div>
      )}

      {modelsError && (
        <div className="p-4 rounded-lg border bg-red-50 border-red-200 mb-6">
          <p className="text-sm text-red-700">
            Could not load the model registry: {modelsError}. You can still save the key, but
            the model dropdown is empty until the registry endpoint is reachable.
          </p>
        </div>
      )}

      {/* API Key Form */}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderKey)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Chat model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={modelsLoading || chatOptionsForProvider.length === 0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          >
            {modelsLoading && <option value="">Loading models…</option>}
            {!modelsLoading && chatOptionsForProvider.length === 0 && (
              <option value="">(no models available)</option>
            )}
            {chatOptionsForProvider.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.deprecated ? ' — legacy' : ''}
              </option>
            ))}
            {/* If the persisted model isn't in the current provider list
                (e.g. user switched providers and the old id no longer
                fits), surface it so the form state stays consistent
                without ever silently mutating their choice. */}
            {model && !chatOptionsForProvider.some((m) => m.id === model) && (
              <option key={model} value={model}>
                {model} (current — not in {provider} list)
              </option>
            )}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {recommendedChatForBanner
              ? `${recommendedChatForBanner.label} is the recommended default for ${provider}.`
              : 'Pick the chat model you want to use.'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Embedding model</label>
          <select
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            disabled={modelsLoading || embeddingOptionsForProvider.length === 0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          >
            {modelsLoading && <option value="">Loading models…</option>}
            {!modelsLoading && embeddingOptionsForProvider.length === 0 && (
              <option value="">(no models available)</option>
            )}
            {embeddingOptionsForProvider.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.deprecated ? ' — legacy' : ''}
                {` (${m.dimensions}d)`}
              </option>
            ))}
            {embeddingModel &&
              !embeddingOptionsForProvider.some((m) => m.id === embeddingModel) && (
                <option key={embeddingModel} value={embeddingModel}>
                  {embeddingModel} (current — not in {provider} list)
                </option>
              )}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Changing this re-indexes your course documents — see the documents tab.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Key {settings?.hasKey && '(replace existing)'}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.hasKey ? 'Enter new key to replace...' : (PROVIDER_KEY_HELP[provider]?.placeholder || 'Enter API key...')}
              className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              required={!settings?.hasKey}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Get your API key from{' '}
            <a
              href={PROVIDER_KEY_HELP[provider]?.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {PROVIDER_KEY_HELP[provider]?.label || 'your provider'}
            </a>
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || (!apiKey && !settings?.hasKey)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : settings?.hasKey ? 'Update Key' : 'Save Key'}
          </button>
          {settings?.hasKey && (
            <button
              type="button"
              onClick={handleRemove}
              className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
            >
              Remove Key
            </button>
          )}
        </div>
      </form>

      {/* Stage 04 (RAG) — Cohere Rerank key (optional, separate vendor). */}
      <div className="mt-10 pt-8 border-t border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          Cohere Rerank Key{' '}
          <span className="text-xs font-normal text-gray-400">(optional)</span>
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          A Cohere API key enables the cross-encoder reranker stage on retrieval, which
          materially improves answer grounding. Independent of the chat-LLM key above —
          skip this and the system falls back to RRF order automatically.
        </p>

        <div
          className={`p-4 rounded-lg border mb-4 ${
            settings?.hasCohereKey
              ? 'bg-green-50 border-green-200'
              : 'bg-gray-50 border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                settings?.hasCohereKey ? 'bg-green-500' : 'bg-gray-400'
              }`}
            />
            <span
              className={`text-sm font-medium ${
                settings?.hasCohereKey ? 'text-green-800' : 'text-gray-600'
              }`}
            >
              {settings?.hasCohereKey
                ? 'Cohere key configured — reranker enabled when RAG_RERANK=true'
                : 'No Cohere key — reranker falls back to RRF order'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveCohere} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cohere API Key{' '}
              {settings?.hasCohereKey && (
                <span className="text-gray-400 font-normal">(replace existing)</span>
              )}
            </label>
            <div className="relative">
              <input
                type={showCohereKey ? 'text' : 'password'}
                value={cohereKey}
                onChange={(e) => setCohereKey(e.target.value)}
                placeholder={
                  settings?.hasCohereKey ? 'Enter new key to replace...' : 'Co-...'
                }
                className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowCohereKey(!showCohereKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
              >
                {showCohereKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Get a Cohere API key from{' '}
              <a
                href="https://dashboard.cohere.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                dashboard.cohere.com/api-keys
              </a>
              . Stored encrypted; never returned to the browser.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingCohere || !cohereKey.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingCohere
                ? 'Saving...'
                : settings?.hasCohereKey
                  ? 'Update Cohere Key'
                  : 'Save Cohere Key'}
            </button>
            {settings?.hasCohereKey && (
              <button
                type="button"
                onClick={handleRemoveCohere}
                className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
              >
                Remove Cohere Key
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Security Note */}
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Security</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>Your API key is encrypted using AES-256-GCM before storage</li>
          <li>The key is only decrypted server-side when making API calls</li>
          <li>Keys are never sent back to the browser after saving</li>
          <li>You can remove your key at any time</li>
        </ul>
      </div>
    </div>
  );
}
