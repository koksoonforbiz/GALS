import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../Toast';

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

const DEFAULT_SETTINGS: DialogueSettings = {
  llmProvider: 'openai',
  llmModel: 'gpt-4o-mini',
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

const MODEL_OPTIONS: Record<string, { label: string; value: string }[]> = {
  openai: [
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
  ],
  gemini: [
    { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
    { label: 'Gemini 2.0 Flash Lite', value: 'gemini-2.0-flash-lite' },
    { label: 'Gemini 2.5 Flash Preview', value: 'gemini-2.5-flash-preview' },
    { label: 'Gemini 2.5 Pro Preview', value: 'gemini-2.5-pro-preview' },
  ],
  fallback: [{ label: 'Fallback (no API key)', value: 'fallback' }],
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

  const updateField = useCallback(
    <K extends keyof DialogueSettings>(key: K, value: DialogueSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        // Auto-switch model when provider changes
        if (key === 'llmProvider') {
          const models = MODEL_OPTIONS[value as string];
          if (models && models[0]) {
            next.llmModel = models[0].value;
          }
        }
        return next;
      });
    },
    [],
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
                className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(MODEL_OPTIONS[settings.llmProvider] || []).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Uses your API key from AI Settings</p>
            </div>
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
