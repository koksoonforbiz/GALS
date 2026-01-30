import { useState } from 'react';
import { apiFetch } from '../lib/api';

// ─── Types ──────────────────────────────────────────────

interface SourceEvidence {
  sourceId: string;
  pageStart: number;
  pageEnd: number;
}

interface LessonModule {
  title: string;
  learningOutcomes: string[];
  estimatedMinutes: number;
}

interface Subtopic {
  title: string;
  lessonModules: LessonModule[];
}

interface OutlineTopic {
  title: string;
  rationale: string;
  sourceEvidence: SourceEvidence[];
  subtopics: Subtopic[];
}

interface OutlineDraft {
  status: 'OK' | 'NOT_ENOUGH_INFO';
  courseStructure: {
    courseTitle: string;
    mode: 'curriculum_based' | 'level_based';
    topics: OutlineTopic[];
  };
  coverage: {
    sourcesUsed: Array<{ sourceId: string; pages: string; whyUsed: string }>;
    gaps: string[];
  };
  _notes: string;
}

interface GenerateResponse {
  jobId: string;
  outlineDraft: OutlineDraft;
}

interface Props {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
  onApplied: () => void;
  toast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

// ─── Component ──────────────────────────────────────────

export default function GenerateStructureWizard({
  courseId,
  courseTitle,
  onClose,
  onApplied,
  toast,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Configuration
  const [mode, setMode] = useState<'curriculum_based' | 'level_based'>('curriculum_based');
  const [desiredTopics, setDesiredTopics] = useState(10);
  const [subtopicsPerTopic, setSubtopicsPerTopic] = useState(4);
  const [lessonsPerSubtopic, setLessonsPerSubtopic] = useState(2);
  const [strictSources, setStrictSources] = useState(true);
  const [adminPrompt, setAdminPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  // Step 2: Preview
  const [jobId, setJobId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OutlineDraft | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);

  // Step 3: Applying
  const [applying, setApplying] = useState(false);

  // ─── Handlers ─────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch<GenerateResponse>(
        `/admin/courses/${courseId}/generate-structure`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode,
            desired_topics: desiredTopics,
            subtopics_per_topic: subtopicsPerTopic,
            lessons_per_subtopic: lessonsPerSubtopic,
            strict_sources: strictSources,
            admin_prompt: adminPrompt || undefined,
          }),
        },
      );
      setJobId(res.jobId);
      setDraft(res.outlineDraft);
      // Expand all topics by default
      setExpandedTopics(new Set(res.outlineDraft.courseStructure.topics.map((_, i) => i)));
      setStep(2);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!jobId || !draft) return;
    setApplying(true);
    try {
      await apiFetch(`/admin/courses/${courseId}/apply-structure/${jobId}`, {
        method: 'POST',
        body: JSON.stringify({ structure: draft }),
      });
      toast('success', 'Course structure applied successfully');
      setStep(3);
      onApplied();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to apply structure');
    } finally {
      setApplying(false);
    }
  };

  const toggleTopic = (index: number) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // ─── Inline editing helpers ───────────────────────────

  const updateTopicTitle = (topicIdx: number, newTitle: string) => {
    if (!draft) return;
    const updated = { ...draft };
    updated.courseStructure = { ...updated.courseStructure };
    updated.courseStructure.topics = [...updated.courseStructure.topics];
    updated.courseStructure.topics[topicIdx] = {
      ...updated.courseStructure.topics[topicIdx]!,
      title: newTitle,
    };
    setDraft(updated);
  };

  const updateSubtopicTitle = (topicIdx: number, subIdx: number, newTitle: string) => {
    if (!draft) return;
    const updated = { ...draft };
    updated.courseStructure = { ...updated.courseStructure };
    updated.courseStructure.topics = [...updated.courseStructure.topics];
    const topic = { ...updated.courseStructure.topics[topicIdx]! };
    topic.subtopics = [...topic.subtopics];
    topic.subtopics[subIdx] = { ...topic.subtopics[subIdx]!, title: newTitle };
    updated.courseStructure.topics[topicIdx] = topic;
    setDraft(updated);
  };

  const updateLessonTitle = (
    topicIdx: number,
    subIdx: number,
    lessonIdx: number,
    newTitle: string,
  ) => {
    if (!draft) return;
    const updated = { ...draft };
    updated.courseStructure = { ...updated.courseStructure };
    updated.courseStructure.topics = [...updated.courseStructure.topics];
    const topic = { ...updated.courseStructure.topics[topicIdx]! };
    topic.subtopics = [...topic.subtopics];
    const sub = { ...topic.subtopics[subIdx]! };
    sub.lessonModules = [...sub.lessonModules];
    sub.lessonModules[lessonIdx] = { ...sub.lessonModules[lessonIdx]!, title: newTitle };
    topic.subtopics[subIdx] = sub;
    updated.courseStructure.topics[topicIdx] = topic;
    setDraft(updated);
  };

  // ─── Count helpers ────────────────────────────────────

  const totalCounts = draft
    ? {
        topics: draft.courseStructure.topics.length,
        subtopics: draft.courseStructure.topics.reduce((s, t) => s + t.subtopics.length, 0),
        lessons: draft.courseStructure.topics.reduce(
          (s, t) => s + t.subtopics.reduce((s2, st) => s2 + st.lessonModules.length, 0),
          0,
        ),
      }
    : null;

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Generate Course Structure</h2>
            <p className="text-sm text-gray-500">{courseTitle}</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-sm">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      step === s
                        ? 'bg-indigo-600 text-white'
                        : step > s
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {step > s ? '\u2713' : s}
                  </div>
                  <span
                    className={`hidden sm:inline ${step === s ? 'text-gray-900 font-medium' : 'text-gray-400'}`}
                  >
                    {s === 1 ? 'Configure' : s === 2 ? 'Preview' : 'Done'}
                  </span>
                  {s < 3 && <span className="text-gray-300 mx-1">/</span>}
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ─── Step 1: Configuration ─── */}
          {step === 1 && (
            <div className="space-y-5 max-w-lg">
              {/* Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Generation Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('curriculum_based');
                      setStrictSources(true);
                    }}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      mode === 'curriculum_based'
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">Curriculum-Based</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Align structure with uploaded curriculum/syllabus documents
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('level_based');
                      setStrictSources(false);
                    }}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      mode === 'level_based'
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">Level-Based</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Beginner to advanced progression, using sources when available
                    </div>
                  </button>
                </div>
              </div>

              {/* Size controls */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Topics (8-12)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={desiredTopics}
                    onChange={(e) => setDesiredTopics(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Subtopics/Topic (3-6)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={subtopicsPerTopic}
                    onChange={(e) => setSubtopicsPerTopic(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Lessons/Subtopic (1-3)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={lessonsPerSubtopic}
                    onChange={(e) => setLessonsPerSubtopic(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Strict sources */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="strictSources"
                  checked={strictSources}
                  onChange={(e) => setStrictSources(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                <label htmlFor="strictSources" className="text-sm text-gray-700">
                  Strict sources (only use uploaded materials, no hallucination)
                </label>
              </div>

              {/* Admin prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Additional Instructions (optional)
                </label>
                <textarea
                  value={adminPrompt}
                  onChange={(e) => setAdminPrompt(e.target.value)}
                  placeholder="e.g. Focus on mechanics and waves; skip astrophysics"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* ─── Step 2: Preview ─── */}
          {step === 2 && draft && (
            <div className="space-y-4">
              {/* Status banner */}
              {draft.status === 'NOT_ENOUGH_INFO' && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="font-medium text-yellow-800 text-sm">
                    Not Enough Information
                  </div>
                  <div className="text-sm text-yellow-700 mt-1">
                    {draft.coverage.gaps.map((gap, i) => (
                      <p key={i}>{gap}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary stats */}
              {totalCounts && (
                <div className="flex gap-4 text-sm">
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded">
                    {totalCounts.topics} topics
                  </span>
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
                    {totalCounts.subtopics} subtopics
                  </span>
                  <span className="px-2 py-1 bg-green-50 text-green-700 rounded">
                    {totalCounts.lessons} lessons
                  </span>
                </div>
              )}

              {/* Outline tree */}
              <div className="space-y-2">
                {draft.courseStructure.topics.map((topic, ti) => (
                  <div key={ti} className="border border-gray-200 rounded-lg">
                    {/* Topic header */}
                    <div
                      className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleTopic(ti)}
                    >
                      <span className="text-gray-400 text-xs">
                        {expandedTopics.has(ti) ? '\u25BC' : '\u25B6'}
                      </span>
                      <span className="text-xs font-mono text-gray-400 w-6">T{ti + 1}</span>
                      {editingField === `t-${ti}` ? (
                        <input
                          autoFocus
                          value={topic.title}
                          onChange={(e) => updateTopicTitle(ti, e.target.value)}
                          onBlur={() => setEditingField(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 px-2 py-0.5 border border-indigo-300 rounded text-sm"
                        />
                      ) : (
                        <span
                          className="flex-1 font-medium text-sm text-gray-900 cursor-text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingField(`t-${ti}`);
                          }}
                          title="Click to edit"
                        >
                          {topic.title}
                        </span>
                      )}
                      {topic.sourceEvidence.length > 0 && (
                        <span className="text-xs text-green-600" title="Has source evidence">
                          {topic.sourceEvidence.length} source(s)
                        </span>
                      )}
                    </div>

                    {/* Topic rationale */}
                    {expandedTopics.has(ti) && topic.rationale && (
                      <div className="px-10 pb-2 text-xs text-gray-500 italic">
                        {topic.rationale}
                      </div>
                    )}

                    {/* Subtopics */}
                    {expandedTopics.has(ti) && (
                      <div className="px-4 pb-3 space-y-2">
                        {topic.subtopics.map((sub, si) => (
                          <div key={si} className="ml-6 border-l-2 border-blue-200 pl-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-gray-400">
                                S{ti + 1}.{si + 1}
                              </span>
                              {editingField === `s-${ti}-${si}` ? (
                                <input
                                  autoFocus
                                  value={sub.title}
                                  onChange={(e) => updateSubtopicTitle(ti, si, e.target.value)}
                                  onBlur={() => setEditingField(null)}
                                  onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                                  className="flex-1 px-2 py-0.5 border border-indigo-300 rounded text-sm"
                                />
                              ) : (
                                <span
                                  className="text-sm text-gray-800 cursor-text"
                                  onClick={() => setEditingField(`s-${ti}-${si}`)}
                                  title="Click to edit"
                                >
                                  {sub.title}
                                </span>
                              )}
                            </div>

                            {/* Lessons */}
                            <div className="ml-6 mt-1 space-y-1">
                              {sub.lessonModules.map((lesson, li) => (
                                <div key={li} className="flex items-center gap-2 text-xs">
                                  <span className="font-mono text-gray-400">
                                    L{ti + 1}.{si + 1}.{li + 1}
                                  </span>
                                  {editingField === `l-${ti}-${si}-${li}` ? (
                                    <input
                                      autoFocus
                                      value={lesson.title}
                                      onChange={(e) =>
                                        updateLessonTitle(ti, si, li, e.target.value)
                                      }
                                      onBlur={() => setEditingField(null)}
                                      onKeyDown={(e) =>
                                        e.key === 'Enter' && setEditingField(null)
                                      }
                                      className="flex-1 px-2 py-0.5 border border-indigo-300 rounded"
                                    />
                                  ) : (
                                    <span
                                      className="text-gray-700 cursor-text"
                                      onClick={() => setEditingField(`l-${ti}-${si}-${li}`)}
                                      title="Click to edit"
                                    >
                                      {lesson.title}
                                    </span>
                                  )}
                                  <span className="text-gray-400">
                                    {lesson.estimatedMinutes}min
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Coverage summary */}
              {draft.coverage.sourcesUsed.length > 0 && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Sources Used</h4>
                  <div className="space-y-1">
                    {draft.coverage.sourcesUsed.map((src, i) => (
                      <div key={i} className="text-xs text-gray-600 flex gap-2">
                        <span className="font-mono text-gray-400">{src.sourceId.slice(0, 8)}</span>
                        <span>Pages: {src.pages}</span>
                        <span className="text-gray-400">|</span>
                        <span>{src.whyUsed}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Gaps */}
              {draft.coverage.gaps.length > 0 && (
                <div className="mt-2 p-3 bg-yellow-50 rounded-lg">
                  <h4 className="text-sm font-medium text-yellow-800 mb-1">Potential Gaps</h4>
                  <ul className="text-xs text-yellow-700 list-disc ml-4">
                    {draft.coverage.gaps.map((gap, i) => (
                      <li key={i}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Notes */}
              {draft._notes && (
                <div className="text-xs text-gray-400 mt-2 italic">{draft._notes}</div>
              )}
            </div>
          )}

          {/* ─── Step 3: Done ─── */}
          {step === 3 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">&#10003;</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Structure Applied</h3>
              <p className="text-sm text-gray-500">
                The course structure has been written to your course. You can now see the topics and
                modules in the Content tab.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          <button
            onClick={step === 3 ? onClose : () => (step === 2 ? setStep(1) : onClose())}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {step === 1 ? 'Cancel' : step === 2 ? 'Back' : 'Close'}
          </button>

          <div className="flex gap-2">
            {step === 1 && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate Structure'}
              </button>
            )}
            {step === 2 && draft?.status === 'OK' && (
              <button
                onClick={handleApply}
                disabled={applying}
                className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {applying ? 'Applying...' : 'Apply to Course'}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={onClose}
                className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
