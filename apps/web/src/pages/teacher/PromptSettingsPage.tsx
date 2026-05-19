import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import {
  FlaskConical,
  Footprints,
  Layers,
  MessageCircleQuestion,
  Target,
  Cog,
  Compass,
  UserCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { TextMiningPromptsTab } from './TextMiningPromptsTab';

interface PromptConfig {
  interventionType: string;
  courseId: string;
  isCustom: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  userPromptTemplate: string;
  label: string;
  description: string;
  warning?: string | null;
}

interface FeedbackConfig {
  feedbackLevel: string;
  courseId: string;
  isCustom: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  label: string;
  description: string;
}

type TabKey = 'interventions' | 'feedback' | 'questiongen' | 'text-mining';

const TYPE_ICONS: Record<string, ReactNode> = {
  PRACTICE_TESTING: <FlaskConical size={20} />,
  STEPWISE_LEARNING: <Footprints size={20} />,
  DISTRIBUTED_PRACTICE: <Layers size={20} />,
  INTERROGATIVE_ELABORATION: <MessageCircleQuestion size={20} />,
};

const FEEDBACK_ICONS: Record<string, ReactNode> = {
  TASK: <Target size={20} />,
  PROCESS: <Cog size={20} />,
  SELF_REGULATION: <Compass size={20} />,
  SELF: <UserCircle size={20} />,
};

export function PromptSettingsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('interventions');

  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Feedback tab state
  const [feedbackConfigs, setFeedbackConfigs] = useState<FeedbackConfig[]>([]);
  const [feedbackEditValues, setFeedbackEditValues] = useState<Record<string, string>>({});
  const [feedbackExpanded, setFeedbackExpanded] = useState<string | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState<Record<string, boolean>>({});
  const [enabledLevels, setEnabledLevels] = useState<string[]>(['TASK']);
  const [savingLevels, setSavingLevels] = useState(false);

  // Question Gen tab state
  const [qgenPrompt, setQgenPrompt] = useState('');
  const qgenDefault = '';
  const [qgenIsCustom, setQgenIsCustom] = useState(false);
  const [qgenSaving, setQgenSaving] = useState(false);

  // Preview modal state
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(
    'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing algorithms that can access data and use it to learn for themselves.',
  );
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const fetchConfigs = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const data = await api.get<PromptConfig[]>(
        `/learning-interventions/prompt-config/${courseId}`,
      );
      setConfigs(data);
      const edits: Record<string, string> = {};
      for (const c of data) {
        edits[c.interventionType] = c.systemPrompt;
      }
      setEditValues(edits);
    } catch {
      toast('error', 'Failed to load prompt configurations');
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  const fetchFeedbackConfigs = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await api.get<FeedbackConfig[]>(
        `/question-generation/feedback-config/${courseId}`,
      );
      setFeedbackConfigs(data);
      const edits: Record<string, string> = {};
      for (const c of data) {
        edits[c.feedbackLevel] = c.systemPrompt;
      }
      setFeedbackEditValues(edits);
    } catch {
      /* ignore */
    }
  }, [courseId]);

  const fetchFeedbackSettings = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await api.get<{ enabledLevels: string[] }>(
        `/question-generation/feedback-settings/${courseId}`,
      );
      setEnabledLevels(data.enabledLevels);
    } catch {
      /* ignore */
    }
  }, [courseId]);

  useEffect(() => {
    void fetchConfigs();
    void fetchFeedbackConfigs();
    void fetchFeedbackSettings();
  }, [fetchConfigs, fetchFeedbackConfigs, fetchFeedbackSettings]);

  const handleSave = async (type: string) => {
    if (!courseId) return;
    setSaving((s) => ({ ...s, [type]: true }));
    try {
      const result = await api.put<PromptConfig & { warning?: string | null }>(
        `/learning-interventions/prompt-config/${courseId}/${type}`,
        { systemPrompt: editValues[type] },
      );
      if (result.warning) {
        toast('info', result.warning);
      } else {
        toast('success', 'Custom prompt saved');
      }
      void fetchConfigs();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving((s) => ({ ...s, [type]: false }));
    }
  };

  const handleRestore = async (type: string) => {
    if (!courseId) return;
    if (
      !window.confirm('This will discard your custom prompt and restore the original. Continue?')
    ) {
      return;
    }
    try {
      await api.delete(`/learning-interventions/prompt-config/${courseId}/${type}`);
      toast('success', 'Restored to default prompt');
      void fetchConfigs();
    } catch {
      toast('error', 'Failed to restore default');
    }
  };

  const handlePreview = async () => {
    if (!previewType) return;
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const result = await api.post<{ output: string }>(
        '/learning-interventions/prompt-config/preview',
        {
          systemPrompt: editValues[previewType],
          sampleText: previewText,
          interventionType: previewType,
        },
      );
      setPreviewResult(result.output);
    } catch (err) {
      setPreviewResult(`Error: ${err instanceof Error ? err.message : 'Preview failed'}`);
    } finally {
      setPreviewing(false);
    }
  };

  // ─── Feedback prompt handlers ───────────────────────

  const handleFeedbackSave = async (level: string) => {
    if (!courseId) return;
    setFeedbackSaving((s) => ({ ...s, [level]: true }));
    try {
      await api.put(`/question-generation/feedback-config/${courseId}/${level}`, {
        systemPrompt: feedbackEditValues[level],
      });
      toast('success', 'Feedback prompt saved');
      void fetchFeedbackConfigs();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setFeedbackSaving((s) => ({ ...s, [level]: false }));
    }
  };

  const handleFeedbackRestore = async (level: string) => {
    if (!courseId) return;
    if (!window.confirm('Restore to default prompt?')) return;
    try {
      await api.delete(`/question-generation/feedback-config/${courseId}/${level}`);
      toast('success', 'Restored to default');
      void fetchFeedbackConfigs();
    } catch {
      toast('error', 'Failed to restore');
    }
  };

  const handleSaveLevels = async () => {
    if (!courseId) return;
    setSavingLevels(true);
    try {
      await api.put(`/question-generation/feedback-settings/${courseId}`, { enabledLevels });
      toast('success', 'Feedback settings saved');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingLevels(false);
    }
  };

  const toggleLevel = (level: string) => {
    setEnabledLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  };

  if (loading) {
    return <div className="text-gray-500">Loading prompt settings...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/teacher/courses/${courseId}`)}
          className="text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Course
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Prompt Settings</h2>
          <p className="text-sm text-gray-500 mt-1">
            Customize AI prompts for interventions, feedback, and question generation.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'interventions' as TabKey, label: 'Learning Interventions' },
          { key: 'feedback' as TabKey, label: 'AI Feedback' },
          { key: 'questiongen' as TabKey, label: 'Question Gen' },
          { key: 'text-mining' as TabKey, label: 'Text-mining (EF)' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Interventions Tab ──────────────────────────── */}
      {activeTab === 'interventions' && (
        <div className="space-y-4">
          {configs.map((config) => {
            const isExpanded = expandedType === config.interventionType;
            const icon = TYPE_ICONS[config.interventionType] || null;
            const hasChanges = editValues[config.interventionType] !== config.systemPrompt;
            const promptValue = editValues[config.interventionType] || '';
            const lowerPrompt = promptValue.toLowerCase();
            const hasJsonWarning =
              promptValue.length > 0 &&
              !(
                lowerPrompt.includes('json') ||
                lowerPrompt.includes('"type"') ||
                /\{\s*"/.test(promptValue)
              );

            return (
              <div
                key={config.interventionType}
                className="bg-white border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Card Header */}
                <button
                  onClick={() => setExpandedType(isExpanded ? null : config.interventionType)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-600">{icon}</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{config.label}</div>
                      <div className="text-xs text-gray-500">{config.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        config.isCustom
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {config.isCustom ? 'Custom' : 'Default'}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {isExpanded ? '\u25B2' : '\u25BC'}
                    </span>
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <div className="mt-3">
                      <label className="text-xs font-medium text-gray-600 block mb-1">
                        System Prompt
                      </label>
                      <textarea
                        value={editValues[config.interventionType] || ''}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            [config.interventionType]: e.target.value,
                          }))
                        }
                        className="w-full h-64 text-xs font-mono border border-gray-300 rounded-lg p-3 focus:outline-none focus:border-blue-400 resize-y"
                        spellCheck={false}
                      />
                    </div>

                    {/* JSON format warning */}
                    {hasJsonWarning && (
                      <div className="mt-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-3 py-2">
                        Your prompt may not include JSON formatting instructions. The intervention
                        may not work correctly.
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => handleSave(config.interventionType)}
                        disabled={saving[config.interventionType] || !hasChanges}
                        className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        {saving[config.interventionType] ? 'Saving...' : 'Save Custom Prompt'}
                      </button>
                      <button
                        onClick={() => handleRestore(config.interventionType)}
                        disabled={!config.isCustom}
                        className="text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Restore Default
                      </button>
                      <button
                        onClick={() => {
                          setPreviewType(config.interventionType);
                          setPreviewResult(null);
                        }}
                        className="text-xs text-blue-600 border border-blue-300 px-3 py-1.5 rounded hover:bg-blue-50 transition-colors"
                      >
                        Preview with Sample Text
                      </button>
                    </div>

                    {/* User prompt template (read-only) */}
                    <div className="mt-4">
                      <label className="text-xs font-medium text-gray-500 block mb-1">
                        User Prompt Template (read-only)
                      </label>
                      <div className="text-xs font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                        {config.userPromptTemplate}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── AI Feedback Tab ──────────────────────────── */}
      {activeTab === 'feedback' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            These prompts control how AI grades and provides feedback on open-ended questions. Each
            level serves a different pedagogical purpose (Hattie&apos;s Four Levels of Feedback).
          </p>

          <div className="space-y-4">
            {feedbackConfigs.map((fc) => {
              const isExpanded = feedbackExpanded === fc.feedbackLevel;
              const hasChanges = feedbackEditValues[fc.feedbackLevel] !== fc.systemPrompt;
              const icon = FEEDBACK_ICONS[fc.feedbackLevel] || '';

              return (
                <div
                  key={fc.feedbackLevel}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setFeedbackExpanded(isExpanded ? null : fc.feedbackLevel)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span>{icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-gray-800">{fc.label}</div>
                        <div className="text-xs text-gray-500">{fc.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          fc.isCustom
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {fc.isCustom ? 'Custom' : 'Default'}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {isExpanded ? '\u25B2' : '\u25BC'}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <div className="mt-3">
                        <label className="text-xs font-medium text-gray-600 block mb-1">
                          System Prompt
                        </label>
                        <textarea
                          value={feedbackEditValues[fc.feedbackLevel] || ''}
                          onChange={(e) =>
                            setFeedbackEditValues((prev) => ({
                              ...prev,
                              [fc.feedbackLevel]: e.target.value,
                            }))
                          }
                          className="w-full h-64 text-xs font-mono border border-gray-300 rounded-lg p-3 focus:outline-none focus:border-blue-400 resize-y"
                          spellCheck={false}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleFeedbackSave(fc.feedbackLevel)}
                          disabled={feedbackSaving[fc.feedbackLevel] || !hasChanges}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {feedbackSaving[fc.feedbackLevel] ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => handleFeedbackRestore(fc.feedbackLevel)}
                          disabled={!fc.isCustom}
                          className="text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Restore Default
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Feedback Level Selection */}
          <div className="mt-8 bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Feedback Level Selection</h3>
            <p className="text-xs text-gray-500 mb-3">
              When AI grades open-ended questions, which feedback levels should be included?
            </p>
            {['TASK', 'PROCESS', 'SELF_REGULATION', 'SELF'].map((level) => (
              <label key={level} className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledLevels.includes(level)}
                  onChange={() => toggleLevel(level)}
                />
                <span className="text-sm flex items-center gap-1.5">
                  <span className="text-gray-600">{FEEDBACK_ICONS[level]}</span>{' '}
                  {level.replace('_', '-').toLowerCase()}-level
                  {level === 'TASK' && (
                    <span className="text-xs text-gray-400 ml-1">
                      (recommended — always include)
                    </span>
                  )}
                </span>
              </label>
            ))}
            <button
              onClick={handleSaveLevels}
              disabled={savingLevels}
              className="mt-3 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            >
              {savingLevels ? 'Saving...' : 'Save Feedback Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Question Gen Tab ─────────────────────────── */}
      {activeTab === 'questiongen' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Customize the system prompt used when AI generates assessment questions from your course
            materials.
          </p>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Question Generation Prompt</h3>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  qgenIsCustom ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                }`}
              >
                {qgenIsCustom ? 'Custom' : 'Default'}
              </span>
            </div>
            <textarea
              value={qgenPrompt}
              onChange={(e) => setQgenPrompt(e.target.value)}
              className="w-full h-80 text-xs font-mono border border-gray-300 rounded-lg p-3 focus:outline-none focus:border-blue-400 resize-y"
              spellCheck={false}
              placeholder="Loading..."
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={async () => {
                  if (!courseId) return;
                  setQgenSaving(true);
                  try {
                    await api.put(
                      `/learning-interventions/prompt-config/${courseId}/PRACTICE_TESTING`,
                      { systemPrompt: qgenPrompt },
                    );
                    toast('success', 'Question generation prompt saved');
                    setQgenIsCustom(true);
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Failed to save');
                  } finally {
                    setQgenSaving(false);
                  }
                }}
                disabled={qgenSaving || qgenPrompt === qgenDefault}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {qgenSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setQgenPrompt(qgenDefault);
                  setQgenIsCustom(false);
                }}
                disabled={!qgenIsCustom}
                className="text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Restore Default
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold text-gray-800">Preview Prompt Output</h3>
              <button
                onClick={() => {
                  setPreviewType(null);
                  setPreviewResult(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Sample Text</label>
              <textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                className="w-full h-24 text-xs border border-gray-300 rounded p-2 mb-3 resize-none"
              />
              <button
                onClick={handlePreview}
                disabled={previewing || !previewText.trim()}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
              >
                {previewing ? 'Running...' : 'Run Preview'}
              </button>

              {previewResult && (
                <div className="mt-4">
                  <label className="text-xs font-medium text-gray-600 block mb-1">LLM Output</label>
                  <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                    {previewResult}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Text-mining (EF construct prompts) Tab ─────── */}
      {activeTab === 'text-mining' && courseId && <TextMiningPromptsTab courseId={courseId} />}
    </div>
  );
}
