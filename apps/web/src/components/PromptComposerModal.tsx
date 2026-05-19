import { useState } from 'react';
import { apiFetch } from '../lib/api';
import SourceSelector from './SourceSelector';

interface Props {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  selectedPageIds: string[];
  selectedPageTitles: string[];
  initialSourceIds: Set<string>;
  onClose: () => void;
  onGenerate: (config: GenerateConfig) => void;
}

export interface GenerateConfig {
  selectedSourceIds: string[];
  strictSources: boolean;
  scopePreference: 'module_only' | 'module_then_course' | 'course_only';
  adminPrompt: string;
}

export default function PromptComposerModal({
  courseId,
  moduleId,
  moduleTitle,
  selectedPageIds,
  selectedPageTitles,
  initialSourceIds,
  onClose,
  onGenerate,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [strictSources, setStrictSources] = useState(true);
  const [scopePreference, setScopePreference] = useState<'module_only' | 'module_then_course' | 'course_only'>('module_then_course');
  const [sourceIds, setSourceIds] = useState<Set<string>>(initialSourceIds);
  const [showSourcePanel, setShowSourcePanel] = useState(false);

  const handleSuggestPrompt = async () => {
    setLoadingSuggestion(true);
    try {
      const res = await apiFetch<{ suggestedPrompt: string }>('/admin/ai/suggest-prompt', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          moduleId,
          pageIds: selectedPageIds,
          selectedSourceIds: Array.from(sourceIds),
          strictSources,
          scopePreference,
        }),
      });
      setPrompt(res.suggestedPrompt);
    } catch (err) {
      setPrompt(`Generate detailed lesson content for the selected page(s) in module "${moduleTitle}".`);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const handleGenerate = () => {
    onGenerate({
      selectedSourceIds: Array.from(sourceIds),
      strictSources,
      scopePreference,
      adminPrompt: prompt,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">AI Content Generator</h2>
            <p className="text-sm text-gray-500">
              {selectedPageIds.length === 1
                ? `Generating for: ${selectedPageTitles[0]}`
                : `Generating for ${selectedPageIds.length} pages`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Pages summary */}
          {selectedPageIds.length > 1 && (
            <div className="p-2 bg-blue-50 rounded-lg">
              <div className="text-xs font-medium text-blue-800 mb-1">Pages to generate ({selectedPageIds.length})</div>
              <div className="flex flex-wrap gap-1">
                {selectedPageTitles.map((title, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">
                    {title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source selection */}
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Sources</span>
              <button
                onClick={() => setShowSourcePanel(!showSourcePanel)}
                className="text-xs text-indigo-600 hover:text-indigo-800 underline"
              >
                {showSourcePanel ? 'Hide' : 'Change sources'}
              </button>
            </div>
            {showSourcePanel ? (
              <SourceSelector
                courseId={courseId}
                selectedSourceIds={sourceIds}
                onSelectionChange={setSourceIds}
              />
            ) : (
              <div className="text-xs text-gray-500">
                {sourceIds.size} source(s) selected
              </div>
            )}
          </div>

          {/* Options row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Scope</label>
              <select
                value={scopePreference}
                onChange={(e) => setScopePreference(e.target.value as any)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
              >
                <option value="module_only">Module only</option>
                <option value="module_then_course">Module + course fallback</option>
                <option value="course_only">All course sources</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={strictSources}
                  onChange={(e) => setStrictSources(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                Strict sources
              </label>
            </div>
          </div>

          {/* Prompt textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Prompt to AI</label>
              <button
                onClick={handleSuggestPrompt}
                disabled={loadingSuggestion}
                className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 disabled:opacity-50"
              >
                {loadingSuggestion ? 'Loading...' : 'AI Suggested Prompt'}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what content you want generated..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              rows={6}
            />
            <p className="text-xs text-gray-400 mt-1">
              Click &quot;AI Suggested Prompt&quot; to auto-fill, then edit as needed.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {selectedPageIds.length === 1
              ? 'Generate Content'
              : `Generate ${selectedPageIds.length} Pages`}
          </button>
        </div>
      </div>
    </div>
  );
}
