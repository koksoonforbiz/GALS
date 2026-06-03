import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../Toast';
import {
  useLlmModels,
  recommendedChatModel,
  type ChatModelSpec,
} from '../../lib/llm/useLlmModels';

interface DialogueSettings {
  llmProvider: string;
  llmModel: string;
  systemPromptOverride?: string;
  citationMode: string;
  allowStudentUploads: boolean;
  maxFilesPerStudent: number;
  maxFileSizeMb: number;
  allowedFileTypes: string[];
  autoGenerateGuide: boolean;
  chunkSize: number;
  chunkOverlap: number;
  topKChunks: number;
  enabledInterventions: string[];
  enabledStudioTools: string[];
}

// Stage 2 of the LLM upgrade (LLM_20260602/): the model picker is now
// driven by the server-side registry via `/llm/models`. The hard-coded
// dropdown lists this file used to ship (with the dead
// `gemini-2.0-flash` default, no less) have been replaced with the
// `useLlmModels` hook. `DEFAULT_SETTINGS.llmModel` stays empty here so
// the first effect after the registry loads can fill it with the
// registry's recommended default — that way a teacher who hits Save
// with no edits still posts a registry-valid model id.
const DEFAULT_SETTINGS: DialogueSettings = {
  llmProvider: 'openai',
  llmModel: '',
  systemPromptOverride: '',
  citationMode: 'inline',
  allowStudentUploads: true,
  maxFilesPerStudent: 20,
  maxFileSizeMb: 25,
  allowedFileTypes: ['PDF', 'DOCX', 'TXT', 'MD', 'CODE'],
  autoGenerateGuide: true,
  chunkSize: 512,
  chunkOverlap: 100,
  topKChunks: 8,
  enabledInterventions: [
    'PRACTICE_TESTING',
    'DISTRIBUTED_PRACTICE',
    'STEPWISE_LEARNING',
    'INTERROGATIVE_ELABORATION',
  ],
  enabledStudioTools: ['BRIEFING_DOC', 'FLASHCARD_SET', 'TABLE_COMPARISON', 'FAQ'],
};

const ALL_FILE_TYPES = [
  { key: 'PDF', label: 'PDF' },
  { key: 'DOCX', label: 'DOCX' },
  { key: 'TXT', label: 'TXT' },
  { key: 'MD', label: 'Markdown' },
  { key: 'CODE', label: 'Code files' },
  { key: 'IMAGE_PNG', label: 'PNG' },
  { key: 'IMAGE_JPG', label: 'JPG' },
  { key: 'IMAGE_WEBP', label: 'WEBP' },
];

const ALL_INTERVENTIONS = [
  {
    key: 'PRACTICE_TESTING',
    label: 'Practice Testing',
    desc: 'Quiz generation from uploaded materials',
  },
  {
    key: 'DISTRIBUTED_PRACTICE',
    label: 'Spaced Repetition',
    desc: 'Flashcards with SM-2 scheduling',
  },
  {
    key: 'STEPWISE_LEARNING',
    label: 'Stepwise Learning',
    desc: 'Guided step-by-step explanations',
  },
  {
    key: 'INTERROGATIVE_ELABORATION',
    label: 'Interrogative Elaboration',
    desc: 'Deep "why/how" questioning',
  },
];

const ALL_STUDIO_TOOLS = [
  { key: 'BRIEFING_DOC', label: 'Briefing Doc' },
  { key: 'FLASHCARD_SET', label: 'Flashcard Set' },
  { key: 'TABLE_COMPARISON', label: 'Table Comparison' },
  { key: 'MIND_MAP', label: 'Mind Map' },
  { key: 'FAQ', label: 'FAQ' },
];

interface Props {
  courseId: string;
  hasApiKey: boolean;
}

export function DialogueCourseSettingsForm({ courseId, hasApiKey }: Props) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DialogueSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Stage 2 LLM upgrade: chat-model dropdown is driven by the registry.
  const { models: registry, loading: registryLoading, error: registryError } = useLlmModels();

  const modelOptionsForProvider = useMemo<ChatModelSpec[]>(() => {
    if (!registry) return [];
    if (settings.llmProvider === 'openai' || settings.llmProvider === 'gemini') {
      return registry.chat.filter((m) => m.provider === settings.llmProvider);
    }
    // `fallback` provider has no real model id — the form hides the
    // model dropdown entirely below in that branch.
    return [];
  }, [registry, settings.llmProvider]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch<{ learningMode: string; settings: DialogueSettings }>(
          `/courses/${courseId}/dialogue-settings`,
        );
        setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [courseId]);

  // After the registry loads, if the form's current model is empty
  // (newly-initialised course or post-provider-flip), fill it with the
  // registry's recommended default for the current provider so the form
  // never submits a blank/invalid `llmModel`.
  useEffect(() => {
    if (!registry) return;
    if (settings.llmProvider !== 'openai' && settings.llmProvider !== 'gemini') return;
    if (settings.llmModel) return;
    const rec = recommendedChatModel(registry, settings.llmProvider);
    if (rec) {
      setSettings((prev) => ({ ...prev, llmModel: rec.id }));
    }
  }, [registry, settings.llmProvider, settings.llmModel]);

  const updateField = useCallback(
    <K extends keyof DialogueSettings>(key: K, value: DialogueSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        // Auto-switch model when provider changes. Stage 2: ask the
        // registry for the new provider's recommended default instead
        // of indexing into a hard-coded dictionary.
        if (key === 'llmProvider') {
          if (value === 'openai' || value === 'gemini') {
            const rec = recommendedChatModel(registry, value);
            if (rec) next.llmModel = rec.id;
            else next.llmModel = '';
          } else {
            // fallback provider has no model.
            next.llmModel = '';
          }
        }
        return next;
      });
    },
    [registry],
  );

  const toggleArrayItem = useCallback(
    (key: 'allowedFileTypes' | 'enabledInterventions' | 'enabledStudioTools', item: string) => {
      setSettings((prev) => {
        const arr = prev[key];
        const next = arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      // First set learning mode to DIALOGUE
      await apiFetch(`/courses/${courseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ learningMode: 'DIALOGUE' }),
      });
      // Then save settings
      await apiFetch(`/courses/${courseId}/dialogue-settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      toast('success', 'Dialogue course settings saved.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const showApiKeyWarning = settings.llmProvider !== 'fallback' && !hasApiKey;

  return (
    <div className="space-y-6">
      {/* Section 1 — LLM Configuration */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">LLM Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LLM Provider</label>
            <div className="flex gap-2">
              {[
                { value: 'openai', label: 'OpenAI' },
                { value: 'gemini', label: 'Google Gemini' },
                { value: 'fallback', label: 'No API key (Fallback)' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateField('llmProvider', opt.value)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    settings.llmProvider === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {settings.llmProvider !== 'fallback' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <select
                value={settings.llmModel}
                onChange={(e) => updateField('llmModel', e.target.value)}
                disabled={registryLoading || modelOptionsForProvider.length === 0}
                className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              >
                {registryLoading && <option value="">Loading models…</option>}
                {!registryLoading && modelOptionsForProvider.length === 0 && (
                  <option value="">(no models available)</option>
                )}
                {modelOptionsForProvider.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.deprecated ? ' — legacy' : ''}
                  </option>
                ))}
                {/* Preserve the persisted choice if it's no longer in the
                    registry list (e.g. the course was saved on a model
                    that has since been retired). The retired-model banner
                    above the form surfaces this case to the teacher. */}
                {settings.llmModel &&
                  !modelOptionsForProvider.some((m) => m.id === settings.llmModel) && (
                    <option key={settings.llmModel} value={settings.llmModel}>
                      {settings.llmModel} (current — not in {settings.llmProvider} list)
                    </option>
                  )}
              </select>
              <p className="text-xs text-gray-500 mt-1">Uses your API key from AI Settings</p>
              {(() => {
                const currentSpec = registry?.chat.find((m) => m.id === settings.llmModel);
                if (!settings.llmModel || !registry) return null;
                if (!currentSpec) {
                  // Persisted id no longer in the registry at all = fully retired.
                  const rec = recommendedChatModel(registry, settings.llmProvider as 'openai' | 'gemini');
                  return (
                    <p className="text-xs text-amber-700 mt-1">
                      Your selected model is retired
                      {rec ? `; switch to ${rec.label}.` : '.'}
                    </p>
                  );
                }
                if (currentSpec.deprecated) {
                  return (
                    <p className="text-xs text-amber-700 mt-1">
                      This is a legacy model. Newer options are recommended.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {registryError && (
            <p className="text-xs text-red-600">
              Could not load the model registry: {registryError}.
            </p>
          )}

          {showApiKeyWarning && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-amber-600 text-sm">Warning:</span>
              <div className="text-sm text-amber-700">
                You haven&apos;t added an API key yet. Students will use the fallback mode until you
                add one in AI Settings.{' '}
                <a
                  href="/teacher/ai-settings"
                  className="underline font-medium hover:text-amber-800"
                >
                  Go to AI Settings
                </a>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              System Prompt (optional)
            </label>
            <textarea
              value={settings.systemPromptOverride || ''}
              onChange={(e) => updateField('systemPromptOverride', e.target.value)}
              placeholder="Optionally override the default tutor system prompt..."
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Citation Mode</label>
            <div className="flex gap-3">
              {(['inline', 'footnote', 'none'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="citationMode"
                    checked={settings.citationMode === mode}
                    onChange={() => updateField('citationMode', mode)}
                    className="text-blue-600"
                  />
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2 — Student Upload Settings */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Student Upload Settings</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.allowStudentUploads}
              onChange={(e) => updateField('allowStudentUploads', e.target.checked)}
              className="rounded text-blue-600"
            />
            Allow student uploads
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Max files per student (1–50)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxFilesPerStudent}
                onChange={(e) => updateField('maxFilesPerStudent', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Max file size (1–100 MB)
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.maxFileSizeMb}
                onChange={(e) => updateField('maxFileSizeMb', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Allowed file types
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_FILE_TYPES.map((ft) => (
                <label
                  key={ft.key}
                  className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-2 py-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={settings.allowedFileTypes.includes(ft.key)}
                    onChange={() => toggleArrayItem('allowedFileTypes', ft.key)}
                    className="rounded text-blue-600"
                  />
                  {ft.label}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.autoGenerateGuide}
              onChange={(e) => updateField('autoGenerateGuide', e.target.checked)}
              className="rounded text-blue-600"
            />
            Auto-generate source guide
          </label>
          <p className="text-xs text-gray-500 -mt-2 ml-6">
            Automatically generate a summary and suggested questions for each uploaded document.
          </p>
        </div>
      </section>

      {/* Section 3 — RAG Settings (Advanced) */}
      <section className="bg-white border border-gray-200 rounded-lg">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-5 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors rounded-lg"
        >
          <span>Advanced RAG Settings</span>
          <span className="text-gray-400">{showAdvanced ? '−' : '+'}</span>
        </button>
        {showAdvanced && (
          <div className="px-5 pb-5 space-y-4 border-t border-gray-100">
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Chunk size (tokens)
                </label>
                <input
                  type="number"
                  min={256}
                  max={2048}
                  value={settings.chunkSize}
                  onChange={(e) => updateField('chunkSize', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Chunk overlap (tokens)
                </label>
                <input
                  type="number"
                  min={0}
                  max={512}
                  value={settings.chunkOverlap}
                  onChange={(e) => updateField('chunkOverlap', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Top-K chunks (1–20)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.topKChunks}
                  onChange={(e) => updateField('topKChunks', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 4 — Learning Interventions */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Enabled Learning Interventions</h3>
        <div className="space-y-3">
          {ALL_INTERVENTIONS.map((intv) => (
            <label key={intv.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.enabledInterventions.includes(intv.key)}
                onChange={() => toggleArrayItem('enabledInterventions', intv.key)}
                className="rounded text-blue-600 mt-0.5"
              />
              <div>
                <span className="font-medium text-gray-700">{intv.label}</span>
                <span className="text-gray-500"> — {intv.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Section 5 — Studio Tools */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Studio Tools</h3>
        <div className="flex flex-wrap gap-3">
          {ALL_STUDIO_TOOLS.map((tool) => (
            <label
              key={tool.key}
              className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg"
            >
              <input
                type="checkbox"
                checked={settings.enabledStudioTools.includes(tool.key)}
                onChange={() => toggleArrayItem('enabledStudioTools', tool.key)}
                className="rounded text-blue-600"
              />
              {tool.label}
            </label>
          ))}
        </div>
      </section>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Dialogue Settings'}
        </button>
      </div>
    </div>
  );
}
