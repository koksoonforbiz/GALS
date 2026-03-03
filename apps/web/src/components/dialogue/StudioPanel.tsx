import { useState, useEffect, useRef } from 'react';
import { FlipCard } from './FlipCard';
import { MindMapTree } from './MindMapTree';
import type { StudentSourceDocument } from './SourceCard';

interface StudioOutput {
  id: string;
  sessionId: string;
  studentId: string;
  type: string;
  title: string;
  content: unknown;
  sourceIds: string[];
  createdAt: string;
}

interface SourceGuide {
  id: string;
  documentId: string;
  summary: string;
  tableOfContents: Array<{ heading: string; level: number; pageRef: number | null }>;
  suggestedQuestions: string[];
  keyTopics: string[];
  generatedAt: string;
}

interface LearningIntervention {
  id: string;
  type: string;
  status: string;
  selectedText: string;
  createdAt: string;
}

interface DialogueCourseSettings {
  enabledStudioTools?: string[];
  enabledInterventions?: string[];
}

interface StudioPanelProps {
  mode: 'studio' | 'guide' | 'interventions';
  onModeChange: (mode: 'studio' | 'guide' | 'interventions') => void;
  selectedSource: StudentSourceDocument | null;
  selectedSourceGuide: SourceGuide | null;
  activeSourceIds: string[];
  sessionId: string | null;
  courseId: string;
  courseSettings: DialogueCourseSettings;
  studioOutputs: StudioOutput[];
  onStudioGenerate: (type: string, promptHint?: string) => Promise<void>;
  onSuggestedQuestionClick: (question: string) => void;
  pastInterventions: LearningIntervention[];
  onStartIntervention: (type: string) => void;
  highlightedExcerpt?: string | null;
  onHighlightClear?: () => void;
}

const STUDIO_TOOLS = [
  { type: 'BRIEFING_DOC', icon: '\u{1F4CB}', name: 'Briefing Doc' },
  { type: 'FLASHCARD_SET', icon: '\u{1F0CF}', name: 'Flashcards' },
  { type: 'TABLE_COMPARISON', icon: '\u{1F4CA}', name: 'Table Comparison' },
  { type: 'MIND_MAP', icon: '\u{1F5FA}', name: 'Mind Map' },
  { type: 'FAQ', icon: '\u{2753}', name: 'FAQ' },
  { type: 'TIMELINE', icon: '\u{23F0}', name: 'Timeline' },
];

const INTERVENTION_TYPES = [
  {
    type: 'PRACTICE_TESTING',
    icon: '\u{1F9EA}',
    name: 'Practice Testing',
    description: 'Test your understanding with questions',
  },
  {
    type: 'DISTRIBUTED_PRACTICE',
    icon: '\u{1F501}',
    name: 'Spaced Repetition',
    description: 'Review flashcards with SM-2 algorithm',
  },
  {
    type: 'STEPWISE_LEARNING',
    icon: '\u{1F4F6}',
    name: 'Stepwise Learning',
    description: 'Break complex topics into guided steps',
  },
  {
    type: 'INTERROGATIVE_ELABORATION',
    icon: '\u{1F4AC}',
    name: 'Interrogative Elaboration',
    description: 'Deepen understanding with why/how questions',
  },
];

export function StudioPanel({
  mode,
  onModeChange,
  selectedSource,
  selectedSourceGuide,
  activeSourceIds,
  sessionId,
  courseSettings,
  studioOutputs,
  onStudioGenerate,
  onSuggestedQuestionClick,
  pastInterventions,
  onStartIntervention,
  highlightedExcerpt,
  onHighlightClear,
}: StudioPanelProps) {
  const [activeOutputId, setActiveOutputId] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [promptHints, setPromptHints] = useState<Record<string, string>>({});
  const [expandedHint, setExpandedHint] = useState<string | null>(null);
  const [showPastInterventions, setShowPastInterventions] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted excerpt when it changes
  useEffect(() => {
    if (highlightedExcerpt && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear highlight after 5 seconds
      const timer = setTimeout(() => onHighlightClear?.(), 5000);
      return () => clearTimeout(timer);
    }
  }, [highlightedExcerpt, onHighlightClear]);

  const activeOutput = studioOutputs.find((o) => o.id === activeOutputId);

  const handleGenerate = async (type: string) => {
    setGenerating(type);
    try {
      await onStudioGenerate(type, promptHints[type]);
    } finally {
      setGenerating(null);
    }
  };

  const enabledTools = courseSettings.enabledStudioTools || STUDIO_TOOLS.map((t) => t.type);
  const enabledInterventions =
    courseSettings.enabledInterventions || INTERVENTION_TYPES.map((t) => t.type);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {(['studio', 'guide', 'interventions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onModeChange(tab)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              mode === tab
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab === 'studio' && '\u{1F3A8} Studio'}
            {tab === 'guide' && '\u{1F4D6} Guide'}
            {tab === 'interventions' && '\u{1F9E0} Learn'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'studio' && (
          <StudioTab
            activeOutput={activeOutput}
            onBack={() => setActiveOutputId(null)}
            studioOutputs={studioOutputs}
            enabledTools={enabledTools}
            activeSourceIds={activeSourceIds}
            generating={generating}
            onGenerate={handleGenerate}
            promptHints={promptHints}
            onPromptHintChange={(type, val) => setPromptHints((prev) => ({ ...prev, [type]: val }))}
            expandedHint={expandedHint}
            onToggleHint={(type) => setExpandedHint(expandedHint === type ? null : type)}
            onViewOutput={(id) => setActiveOutputId(id)}
          />
        )}

        {mode === 'guide' && (
          <GuideTab
            selectedSource={selectedSource}
            guide={selectedSourceGuide}
            onQuestionClick={onSuggestedQuestionClick}
            highlightedExcerpt={highlightedExcerpt}
            highlightRef={highlightRef}
          />
        )}

        {mode === 'interventions' && (
          <InterventionsTab
            enabledInterventions={enabledInterventions}
            sessionId={sessionId}
            onStartIntervention={onStartIntervention}
            pastInterventions={pastInterventions}
            showPast={showPastInterventions}
            onTogglePast={() => setShowPastInterventions(!showPastInterventions)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Studio Tab ──────────────────────────────────────────

function StudioTab({
  activeOutput,
  onBack,
  studioOutputs,
  enabledTools,
  activeSourceIds,
  generating,
  onGenerate,
  promptHints,
  onPromptHintChange,
  expandedHint,
  onToggleHint,
  onViewOutput,
}: {
  activeOutput: StudioOutput | undefined;
  onBack: () => void;
  studioOutputs: StudioOutput[];
  enabledTools: string[];
  activeSourceIds: string[];
  generating: string | null;
  onGenerate: (type: string) => void;
  promptHints: Record<string, string>;
  onPromptHintChange: (type: string, val: string) => void;
  expandedHint: string | null;
  onToggleHint: (type: string) => void;
  onViewOutput: (id: string) => void;
}) {
  if (activeOutput) {
    return (
      <div className="p-4">
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:text-blue-700 mb-3 flex items-center gap-1"
        >
          <span>&larr;</span> Back to Tools
        </button>
        <div className="flex items-center gap-2 mb-4">
          <h4 className="font-semibold text-sm">{activeOutput.title}</h4>
          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
            {activeOutput.type.replace('_', ' ')}
          </span>
        </div>
        <StudioOutputRenderer output={activeOutput} />
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {STUDIO_TOOLS.map((tool) => {
          const enabled = enabledTools.includes(tool.type);
          const isGenerating = generating === tool.type;

          return (
            <div
              key={tool.type}
              className={`rounded-lg border p-3 ${enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}
            >
              <div className="text-2xl mb-1">{tool.icon}</div>
              <div className="text-xs font-medium text-gray-900 mb-2">{tool.name}</div>

              {expandedHint === tool.type && (
                <textarea
                  value={promptHints[tool.type] || ''}
                  onChange={(e) => onPromptHintChange(tool.type, e.target.value)}
                  placeholder="Optional focus hint..."
                  className="w-full text-xs border border-gray-200 rounded p-1.5 mb-2 resize-none"
                  rows={2}
                />
              )}

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleGenerate(tool.type)}
                  disabled={!enabled || activeSourceIds.length === 0 || isGenerating}
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? 'Generating...' : 'Generate'}
                </button>
                {enabled && (
                  <button
                    onClick={() => onToggleHint(tool.type)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-1"
                    title="Add focus hint"
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          );

          function handleGenerate(type: string) {
            onGenerate(type);
          }
        })}
      </div>

      {/* Saved outputs */}
      {studioOutputs.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Saved Outputs</h4>
          <div className="space-y-1">
            {studioOutputs.map((output) => (
              <button
                key={output.id}
                onClick={() => onViewOutput(output.id)}
                className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <div className="text-xs font-medium">{output.title}</div>
                <div className="text-xs text-gray-400">
                  {output.type.replace('_', ' ')} &middot;{' '}
                  {new Date(output.createdAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Studio Output Renderer ──────────────────────────────

function StudioOutputRenderer({ output }: { output: StudioOutput }) {
  const content = output.content as Record<string, unknown>;

  switch (output.type) {
    case 'BRIEFING_DOC':
    case 'TIMELINE':
      return (
        <BriefingDocRenderer
          sections={(content.sections as Array<{ heading: string; body: string }>) || []}
        />
      );
    case 'FLASHCARD_SET':
      return (
        <FlashcardSetRenderer
          cards={(content.cards as Array<{ front: string; back: string }>) || []}
        />
      );
    case 'TABLE_COMPARISON':
      return (
        <TableRenderer
          headers={(content.headers as string[]) || []}
          rows={(content.rows as string[][]) || []}
          caption={content.caption as string | undefined}
        />
      );
    case 'MIND_MAP':
      return (
        <MindMapTree
          root={(content.root as string) || 'Root'}
          nodes={
            (content.nodes as Array<{
              id: string;
              label: string;
              parentId: string | null;
              level: number;
            }>) || []
          }
        />
      );
    case 'FAQ':
      return (
        <FaqRenderer items={(content.items as Array<{ question: string; answer: string }>) || []} />
      );
    default:
      return <pre className="text-xs overflow-x-auto">{JSON.stringify(content, null, 2)}</pre>;
  }
}

function BriefingDocRenderer({ sections }: { sections: Array<{ heading: string; body: string }> }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  return (
    <div className="space-y-2">
      {sections.map((section, i) => (
        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                next.has(i) ? next.delete(i) : next.add(i);
                return next;
              })
            }
            className="w-full text-left px-3 py-2 text-sm font-medium bg-gray-50 hover:bg-gray-100 flex items-center justify-between"
          >
            {section.heading}
            <span className="text-gray-400">{expanded.has(i) ? '\u25B2' : '\u25BC'}</span>
          </button>
          {expanded.has(i) && (
            <div className="px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
              {section.body}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FlashcardSetRenderer({ cards }: { cards: Array<{ front: string; back: string }> }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (cards.length === 0) return <p className="text-sm text-gray-400">No cards generated.</p>;

  return (
    <div>
      <FlipCard
        front={cards[currentIndex]!.front}
        back={cards[currentIndex]!.back}
        index={currentIndex}
        total={cards.length}
      />
      <div className="flex justify-between mt-3">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="text-xs px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => setCurrentIndex((i) => Math.min(cards.length - 1, i + 1))}
          disabled={currentIndex === cards.length - 1}
          className="text-xs px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function TableRenderer({
  headers,
  rows,
  caption,
}: {
  headers: string[];
  rows: string[][];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border border-gray-200 px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <p className="text-xs text-gray-500 mt-1 italic">{caption}</p>}
    </div>
  );
}

function FaqRenderer({ items }: { items: Array<{ question: string; answer: string }> }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                next.has(i) ? next.delete(i) : next.add(i);
                return next;
              })
            }
            className="w-full text-left px-3 py-2 text-sm font-medium hover:bg-gray-50 flex items-center justify-between"
          >
            <span>Q: {item.question}</span>
            <span className="text-gray-400 ml-2">{expanded.has(i) ? '\u25B2' : '\u25BC'}</span>
          </button>
          {expanded.has(i) && (
            <div className="px-3 py-2 text-sm text-gray-700 bg-green-50/50 whitespace-pre-wrap">
              A: {item.answer}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Guide Tab ───────────────────────────────────────────

function GuideTab({
  selectedSource,
  guide,
  onQuestionClick,
  highlightedExcerpt,
  highlightRef,
}: {
  selectedSource: StudentSourceDocument | null;
  guide: SourceGuide | null;
  onQuestionClick: (question: string) => void;
  highlightedExcerpt?: string | null;
  highlightRef?: React.Ref<HTMLDivElement>;
}) {
  const [tocExpanded, setTocExpanded] = useState(true);

  if (!selectedSource) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="text-3xl mb-3">{'\u{1F4D6}'}</div>
        <p className="text-sm text-gray-500">
          Select a source from the left panel or click a citation to view its guide.
        </p>
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="p-4">
        <h4 className="text-sm font-semibold mb-2">{selectedSource.originalName}</h4>
        <p className="text-sm text-gray-400">
          {selectedSource.processingStatus === 'COMPLETED'
            ? 'Guide is being generated...'
            : 'Source is still processing. Guide will be available once processing completes.'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h4 className="text-sm font-semibold">{selectedSource.originalName}</h4>

      {/* Highlighted Citation Excerpt */}
      {highlightedExcerpt && (
        <div
          ref={highlightRef}
          className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg animate-pulse"
          style={{ animationIterationCount: 3 }}
        >
          <h5 className="text-xs font-medium text-yellow-700 uppercase mb-1">Referenced Passage</h5>
          <p className="text-sm text-yellow-900 whitespace-pre-wrap">{highlightedExcerpt}</p>
        </div>
      )}

      {/* Summary */}
      <div>
        <h5 className="text-xs font-medium text-gray-500 uppercase mb-1">Summary</h5>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{guide.summary}</p>
      </div>

      {/* Table of Contents */}
      {guide.tableOfContents.length > 0 && (
        <div>
          <button
            onClick={() => setTocExpanded(!tocExpanded)}
            className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1"
          >
            Table of Contents {tocExpanded ? '\u25B2' : '\u25BC'}
          </button>
          {tocExpanded && (
            <ul className="mt-1 space-y-0.5">
              {guide.tableOfContents.map((entry, i) => (
                <li
                  key={i}
                  className="text-sm text-gray-600"
                  style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
                >
                  {entry.heading}
                  {entry.pageRef && (
                    <span className="text-xs text-gray-400 ml-1">p.{entry.pageRef}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Suggested Questions */}
      {guide.suggestedQuestions.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-gray-500 uppercase mb-1">Suggested Questions</h5>
          <div className="space-y-1">
            {guide.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => onQuestionClick(q)}
                className="w-full text-left text-xs p-2 rounded border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Key Topics */}
      {guide.keyTopics.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-gray-500 uppercase mb-1">Key Topics</h5>
          <div className="flex flex-wrap gap-1">
            {guide.keyTopics.map((topic, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-200"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Interventions Tab ───────────────────────────────────

function InterventionsTab({
  enabledInterventions,
  sessionId,
  onStartIntervention,
  pastInterventions,
  showPast,
  onTogglePast,
}: {
  enabledInterventions: string[];
  sessionId: string | null;
  onStartIntervention: (type: string) => void;
  pastInterventions: LearningIntervention[];
  showPast: boolean;
  onTogglePast: () => void;
}) {
  return (
    <div className="p-4 space-y-3">
      {INTERVENTION_TYPES.map((intervention) => {
        const enabled = enabledInterventions.includes(intervention.type);
        const pastCount = pastInterventions.filter((p) => p.type === intervention.type).length;

        return (
          <div
            key={intervention.type}
            className={`rounded-lg border p-3 ${enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}
          >
            <div className="flex items-start gap-2">
              <span className="text-xl">{intervention.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-medium">{intervention.name}</div>
                <p className="text-xs text-gray-500 mt-0.5">{intervention.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => onStartIntervention(intervention.type)}
                    disabled={!enabled || !sessionId}
                    className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    Start Session
                  </button>
                  {pastCount > 0 && (
                    <span className="text-xs text-gray-400">
                      {pastCount} past session{pastCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Past interventions */}
      {pastInterventions.length > 0 && (
        <div>
          <button
            onClick={onTogglePast}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {showPast ? 'Hide' : 'View'} Past Sessions ({pastInterventions.length})
          </button>

          {showPast && (
            <div className="mt-2 space-y-1">
              {pastInterventions.map((intervention) => (
                <div
                  key={intervention.id}
                  className="flex items-center justify-between p-2 rounded border border-gray-200 text-xs"
                >
                  <div>
                    <span className="font-medium">{intervention.type.replace('_', ' ')}</span>
                    <span className="text-gray-400 ml-2">
                      {new Date(intervention.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full ${
                      intervention.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {intervention.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type {
  StudioOutput,
  SourceGuide,
  LearningIntervention,
  DialogueCourseSettings,
  StudioPanelProps,
};
