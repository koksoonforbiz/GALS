import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface LlmSettings {
  provider: string | null;
  model: string | null;
  hasKey: boolean;
}

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (cheapest, fast)' },
  { value: 'gpt-4o', label: 'GPT-4o (best quality)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (legacy, cheapest)' },
];

export function AiSettingsPage() {
  const { toast } = useToast();

  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<LlmSettings>('/llm-settings');
        setSettings(data);
        if (data.provider) setProvider(data.provider);
        if (data.model) setModel(data.model);
      } catch {
        toast('error', 'Failed to load AI settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/llm-settings', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey, model }),
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
      setSettings({ provider: null, model: null, hasKey: false });
      setApiKey('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading AI settings...</div>;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Settings</h2>
      <p className="text-sm text-gray-500 mb-6">
        Configure your OpenAI API key to enable AI-powered content generation in the Course Studio.
        Your key is encrypted at rest and only used for your requests.
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
              ? `Connected - ${settings.provider || 'openai'} / ${settings.model || 'gpt-4o-mini'}`
              : 'Not configured - using template mode (no AI)'}
          </span>
        </div>
        {!settings?.hasKey && (
          <p className="text-xs text-yellow-700 mt-2">
            Without an API key, the Course Studio will use template-based content generation.
            To use real AI, enter your OpenAI API key below.
          </p>
        )}
      </div>

      {/* API Key Form */}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {OPENAI_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            GPT-4o Mini is recommended for a balance of cost and quality.
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
              placeholder={settings?.hasKey ? 'Enter new key to replace...' : 'sk-...'}
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
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              platform.openai.com/api-keys
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
