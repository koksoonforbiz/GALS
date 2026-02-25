import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { FlaskConical, Footprints, Layers, MessageCircleQuestion } from 'lucide-react';
import type { ReactNode } from 'react';

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

const TYPE_ICONS: Record<string, ReactNode> = {
  PRACTICE_TESTING: <FlaskConical size={20} />,
  STEPWISE_LEARNING: <Footprints size={20} />,
  DISTRIBUTED_PRACTICE: <Layers size={20} />,
  INTERROGATIVE_ELABORATION: <MessageCircleQuestion size={20} />,
};

export function PromptSettingsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [configs, setConfigs] = useState<PromptConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

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
          <h2 className="text-2xl font-bold text-gray-900">
            Learning Intervention Prompt Settings
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Customize how the AI generates content for each learning intervention. Edit prompts to
            match your course objectives, or restore to defaults.
          </p>
        </div>
      </div>

      {/* Intervention Cards */}
      <div className="space-y-4">
        {configs.map((config) => {
          const isExpanded = expandedType === config.interventionType;
          const icon = TYPE_ICONS[config.interventionType] || null;
          const hasChanges = editValues[config.interventionType] !== config.systemPrompt;
          const promptValue = editValues[config.interventionType] || '';
          const hasJsonWarning =
            promptValue.length > 0 &&
            !(
              promptValue.toLowerCase().includes('json') &&
              promptValue.toLowerCase().includes('format')
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
                  <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
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
                      Your prompt may not include JSON formatting instructions. The intervention may
                      not work correctly.
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
    </div>
  );
}
