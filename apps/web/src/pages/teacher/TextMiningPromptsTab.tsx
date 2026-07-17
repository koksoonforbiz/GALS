import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, RotateCcw, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { formatDateTimeSGT } from '../../lib/formatDateTime';

// Mirrors apps/api/src/text-mining/detection/constructs.ts. Kept in sync
// manually because @ats/shared doesn't currently re-export the construct
// catalog; if/when it does, replace this with a shared import.
interface Construct {
  key: string;
  displayName: string;
  feasibility: 1 | 2 | 3 | 4 | 5;
  needsRetrieval: boolean;
  warning: string | null;
}

interface PromptInfo {
  promptText: string;
  version: number;
  isDefault: boolean;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
}

interface TryResult {
  ok: boolean;
  parsed?: Record<string, unknown>;
  raw?: string;
  error?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

const SAMPLE_UTTERANCE =
  "I'm not really sure if I got this right — let me think again. Wait, did I divide when I should have multiplied?";

export function TextMiningPromptsTab({ courseId }: { courseId: string }) {
  const { toast } = useToast();
  const [constructs, setConstructs] = useState<Construct[]>([]);
  const [prompts, setPrompts] = useState<Record<string, PromptInfo>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [resetting, setResetting] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Try-it panel state, keyed by construct
  const [tryUtterance, setTryUtterance] = useState<Record<string, string>>({});
  const [tryTopic, setTryTopic] = useState<Record<string, string>>({});
  const [tryRunning, setTryRunning] = useState<Record<string, boolean>>({});
  const [tryResult, setTryResult] = useState<Record<string, TryResult>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [constructsRes, promptsRes] = await Promise.all([
        api.get<Construct[]>('/text-mining/constructs'),
        api.get<{ prompts: Record<string, PromptInfo> }>(
          `/text-mining/courses/${courseId}/prompts`,
        ),
      ]);
      setConstructs(constructsRes);
      setPrompts(promptsRes.prompts);
      const initialEdits: Record<string, string> = {};
      for (const key of Object.keys(promptsRes.prompts)) {
        initialEdits[key] = promptsRes.prompts[key]!.promptText;
      }
      setEdits(initialEdits);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleSave = async (constructKey: string) => {
    setSaving((s) => ({ ...s, [constructKey]: true }));
    try {
      await api.put<{ version: number }>(`/text-mining/courses/${courseId}/prompts`, {
        constructKey,
        promptText: edits[constructKey],
      });
      toast('success', `Saved override for ${constructKey}`);
      await fetchAll();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving((s) => ({ ...s, [constructKey]: false }));
    }
  };

  const handleReset = async (constructKey: string) => {
    if (
      !window.confirm(
        `Discard the course-specific override for ${constructKey} and revert to the global default?`,
      )
    ) {
      return;
    }
    setResetting((s) => ({ ...s, [constructKey]: true }));
    try {
      await api.post(`/text-mining/courses/${courseId}/prompts/reset`, { constructKey });
      toast('success', 'Reset to default');
      await fetchAll();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting((s) => ({ ...s, [constructKey]: false }));
    }
  };

  const handleTry = async (construct: Construct) => {
    const utterance = tryUtterance[construct.key] || SAMPLE_UTTERANCE;
    const topic = construct.needsRetrieval ? tryTopic[construct.key] || '' : undefined;
    setTryRunning((s) => ({ ...s, [construct.key]: true }));
    setTryResult((s) => ({ ...s, [construct.key]: { ok: false } as TryResult }));
    try {
      const res = await api.post<TryResult>('/text-mining/prompts/try', {
        constructKey: construct.key,
        promptText: edits[construct.key] || '',
        utterance,
        courseTopic: topic,
        courseId,
      });
      setTryResult((s) => ({ ...s, [construct.key]: res }));
    } catch (err) {
      setTryResult((s) => ({
        ...s,
        [construct.key]: {
          ok: false,
          error: err instanceof Error ? err.message : 'Request failed',
        },
      }));
    } finally {
      setTryRunning((s) => ({ ...s, [construct.key]: false }));
    }
  };

  const sortedConstructs = useMemo(
    () => [...constructs].sort((a, b) => b.feasibility - a.feasibility),
    [constructs],
  );

  if (loading) {
    return <div className="text-gray-500">Loading text-mining prompts...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        Per-construct prompt overrides for executive-function detection. The course override is used
        if present; otherwise the global default seeded from{' '}
        <code className="text-[11px] bg-white/60 rounded px-1">default-prompts.ts</code> is used.
        Editing here creates a new version (history is preserved). The{' '}
        <code className="text-[11px] bg-white/60 rounded px-1">
          &lt;&lt;&lt;INSERT_UTTERANCE&gt;&gt;&gt;
        </code>{' '}
        placeholder is required; the engagement construct also needs{' '}
        <code className="text-[11px] bg-white/60 rounded px-1">
          &lt;&lt;&lt;INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM&gt;&gt;&gt;
        </code>
        .
      </div>

      {sortedConstructs.map((construct) => {
        const info = prompts[construct.key];
        if (!info) return null;
        const isExpanded = expanded === construct.key;
        const promptValue = edits[construct.key] ?? '';
        const hasChanges = promptValue !== info.promptText;
        const placeholderMissing = !promptValue.includes('<<<INSERT_UTTERANCE>>>');
        const engagementPlaceholderMissing =
          construct.needsRetrieval &&
          !promptValue.includes('<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>');
        const result = tryResult[construct.key];

        return (
          <div
            key={construct.key}
            className="bg-white border border-gray-200 rounded-lg overflow-hidden"
          >
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : construct.key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Sparkles size={18} className="text-gray-500" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">{construct.displayName}</div>
                  <div className="text-xs text-gray-500">
                    <code className="text-[11px]">{construct.key}</code>
                    {' · feasibility '}
                    {construct.feasibility}/5
                    {construct.warning && (
                      <span className="text-amber-700 ml-2">⚠ {construct.warning}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    info.isDefault ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {info.isDefault ? 'Default' : `Custom v${info.version}`}
                </span>
                <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
              </div>
            </button>

            {/* Body */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-gray-100">
                <div className="mt-3">
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Prompt template
                  </label>
                  <textarea
                    value={promptValue}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [construct.key]: e.target.value }))
                    }
                    className="w-full h-72 text-xs font-mono border border-gray-300 rounded-lg p-3 focus:outline-none focus:border-blue-400 resize-y"
                    spellCheck={false}
                  />
                </div>

                {(placeholderMissing || engagementPlaceholderMissing) && (
                  <div className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2 flex items-start gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <div>
                      Missing required placeholder
                      {placeholderMissing && (
                        <code className="mx-1">&lt;&lt;&lt;INSERT_UTTERANCE&gt;&gt;&gt;</code>
                      )}
                      {engagementPlaceholderMissing && (
                        <code className="mx-1">
                          &lt;&lt;&lt;INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM&gt;&gt;&gt;
                        </code>
                      )}
                      . Save will be rejected by the API.
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => handleSave(construct.key)}
                    disabled={
                      saving[construct.key] ||
                      !hasChanges ||
                      placeholderMissing ||
                      engagementPlaceholderMissing
                    }
                    className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving[construct.key]
                      ? 'Saving...'
                      : info.isDefault
                        ? 'Save as Override'
                        : 'Save New Version'}
                  </button>
                  <button
                    onClick={() => handleReset(construct.key)}
                    disabled={info.isDefault || resetting[construct.key]}
                    className="text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <RotateCcw size={12} />
                    {resetting[construct.key] ? 'Resetting...' : 'Reset to default'}
                  </button>
                  {info.lastEditedAt && (
                    <span className="text-xs text-gray-400 ml-2">
                      Last edited {formatDateTimeSGT(info.lastEditedAt)}
                    </span>
                  )}
                </div>

                {/* Try it panel */}
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Play size={14} className="text-blue-500" />
                    <span className="text-sm font-medium text-gray-800">Try it</span>
                    <span className="text-xs text-gray-400">
                      Runs the current (unsaved) prompt against your LLM.
                    </span>
                  </div>
                  <textarea
                    placeholder={SAMPLE_UTTERANCE}
                    value={tryUtterance[construct.key] ?? ''}
                    onChange={(e) =>
                      setTryUtterance((prev) => ({ ...prev, [construct.key]: e.target.value }))
                    }
                    className="w-full h-20 text-xs border border-gray-300 rounded-lg p-2 focus:outline-none focus:border-blue-400 resize-y"
                  />
                  {construct.needsRetrieval && (
                    <input
                      type="text"
                      placeholder="Course topic / current problem (for engagement classifier)"
                      value={tryTopic[construct.key] ?? ''}
                      onChange={(e) =>
                        setTryTopic((prev) => ({ ...prev, [construct.key]: e.target.value }))
                      }
                      className="mt-2 w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400"
                    />
                  )}
                  <button
                    onClick={() => handleTry(construct)}
                    disabled={
                      tryRunning[construct.key] ||
                      placeholderMissing ||
                      engagementPlaceholderMissing
                    }
                    className="mt-2 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {tryRunning[construct.key] ? 'Running...' : 'Run'}
                  </button>

                  {result && (
                    <div className="mt-3">
                      {result.error && (
                        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">
                          {result.error}
                        </div>
                      )}
                      {result.parsed && (
                        <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(result.parsed, null, 2)}
                        </pre>
                      )}
                      {result.raw && !result.parsed && (
                        <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                          {result.raw}
                        </pre>
                      )}
                      {(result.latencyMs !== undefined ||
                        result.promptTokens !== undefined ||
                        result.completionTokens !== undefined) && (
                        <div className="mt-1 text-[11px] text-gray-400">
                          {result.latencyMs !== undefined && `${result.latencyMs}ms`}
                          {result.promptTokens !== undefined &&
                            ` · prompt ${result.promptTokens} tok`}
                          {result.completionTokens !== undefined &&
                            ` · completion ${result.completionTokens} tok`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
