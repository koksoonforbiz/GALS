import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { RagDebugDrawer, RagDebugData } from '../../components/RagDebugDrawer';
import { formatDateTimeSGT } from '../../lib/formatDateTime';

// ─── Types ──────────────────────────────────────────────

interface Draft {
  id: string;
  title: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  version: number;
  createdAt: string;
  reviewedAt: string | null;
  createdBy: { id: string; name: string };
}

interface DraftDetail extends Draft {
  contentMdx: string;
  citations: Array<{
    chunkId: string;
    documentTitle: string;
    pageNumber: number | null;
    quote: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    createdAt: string;
  }>;
}

interface AuditLog {
  id: string;
  action: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
  draft: { id: string; title: string } | null;
}

interface Course {
  id: string;
  title: string;
}

type StudioTab = 'generate' | 'drafts' | 'query' | 'logs';

// ─── Component ──────────────────────────────────────────

export function CourseStudioPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>('generate');
  const [loading, setLoading] = useState(true);

  // Generate tab
  const [genTitle, setGenTitle] = useState('');
  const [genPrompt, setGenPrompt] = useState('');
  const [strictSource, setStrictSource] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<DraftDetail | null>(null);
  const [editedContent, setEditedContent] = useState('');

  // Query tab (RAG Q&A)
  const [queryText, setQueryText] = useState('');
  const [queryAnswer, setQueryAnswer] = useState('');
  const [querying, setQuerying] = useState(false);

  // Debug drawer
  const [debugData, setDebugData] = useState<RagDebugData | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // Drafts tab
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<DraftDetail | null>(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  // Logs tab
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // ─── Fetch Course ──────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<Course>(`/courses/${courseId}`);
        setCourse(data);
      } catch {
        toast('error', 'Failed to load course');
        navigate('/teacher/courses');
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Tab data loaders ─────────────────────────────────

  const fetchDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const data = await apiFetch<Draft[]>(`/courses/${courseId}/drafts`);
      setDrafts(data);
    } catch {
      toast('error', 'Failed to load drafts');
    } finally {
      setLoadingDrafts(false);
    }
  }, [courseId, toast]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const data = await apiFetch<AuditLog[]>(`/courses/${courseId}/llm-logs`);
      setAuditLogs(data);
    } catch {
      toast('error', 'Failed to load audit logs');
    } finally {
      setLoadingLogs(false);
    }
  }, [courseId, toast]);

  useEffect(() => {
    if (activeTab === 'drafts') fetchDrafts();
    if (activeTab === 'logs') fetchLogs();
  }, [activeTab, fetchDrafts, fetchLogs]);

  // ─── Generate Content ─────────────────────────────────

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setGeneratedDraft(null);
    try {
      const result = await apiFetch<{
        draft: DraftDetail;
        citations: any[];
        strictSourceValid: boolean;
        notEnoughInfo: boolean;
        debugInfo: any;
      }>(`/courses/${courseId}/rag/generate`, {
        method: 'POST',
        body: JSON.stringify({
          title: genTitle,
          prompt: genPrompt,
          strictSource,
        }),
      });

      setGeneratedDraft(result.draft);
      setEditedContent(result.draft.contentMdx);

      // Build debug data for drawer
      setDebugData({
        query: genPrompt,
        retrievedChunks: result.debugInfo?.chunksUsed || [],
        finalChunks: result.debugInfo?.chunksUsed || [],
        citations: result.citations || [],
        strictSourceValid: result.strictSourceValid,
        notEnoughInfo: result.notEnoughInfo,
        debugInfo: {
          totalChunksSearched: result.debugInfo?.chunksUsed?.length || 0,
          retrievalTimeMs: 0,
          rerankTimeMs: 0,
          generationTimeMs: result.debugInfo?.durationMs || 0,
          model: result.debugInfo?.model,
          promptTokens: result.debugInfo?.promptTokens,
          completionTokens: result.debugInfo?.completionTokens,
        },
      });

      toast('success', 'Draft generated');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ─── RAG Query ────────────────────────────────────────

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuerying(true);
    setQueryAnswer('');
    try {
      const result = await apiFetch<{
        query: string;
        retrievedChunks: any[];
        finalChunks: any[];
        answer: string;
        citations: any[];
        strictSourceValid: boolean;
        notEnoughInfo: boolean;
        debugInfo: any;
      }>(`/courses/${courseId}/rag/query`, {
        method: 'POST',
        body: JSON.stringify({ query: queryText, strictSource }),
      });

      setQueryAnswer(result.answer || '');
      setDebugData({
        query: result.query,
        retrievedChunks: result.retrievedChunks,
        finalChunks: result.finalChunks,
        citations: result.citations,
        strictSourceValid: result.strictSourceValid,
        notEnoughInfo: result.notEnoughInfo,
        debugInfo: result.debugInfo,
      });

      toast('info', 'Query complete');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Query failed');
    } finally {
      setQuerying(false);
    }
  };

  // ─── Draft Actions ────────────────────────────────────

  const handleApproveDraft = async (draftId: string, content?: string) => {
    try {
      await apiFetch(`/drafts/${draftId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ contentMdx: content }),
      });
      toast('success', 'Draft approved');
      if (generatedDraft?.id === draftId) {
        setGeneratedDraft({ ...generatedDraft, status: 'APPROVED' });
      }
      fetchDrafts();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Approve failed');
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    try {
      await apiFetch(`/drafts/${draftId}/reject`, { method: 'POST' });
      toast('success', 'Draft rejected');
      if (generatedDraft?.id === draftId) {
        setGeneratedDraft({ ...generatedDraft, status: 'REJECTED' });
      }
      fetchDrafts();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Reject failed');
    }
  };

  const handleViewDraft = async (draftId: string) => {
    try {
      const draft = await apiFetch<DraftDetail>(`/drafts/${draftId}`);
      setSelectedDraft(draft);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load draft');
    }
  };

  // ─── Render ───────────────────────────────────────────

  if (loading || !course) {
    return <div className="text-gray-500">Loading studio...</div>;
  }

  const tabs: { key: StudioTab; label: string }[] = [
    { key: 'generate', label: 'Generate Content' },
    { key: 'query', label: 'RAG Query' },
    { key: 'drafts', label: 'Drafts' },
    { key: 'logs', label: 'Audit Logs' },
  ];

  return (
    <div className={`${debugOpen ? 'mr-[480px]' : ''} transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/teacher/courses/${courseId}`)}
            className="text-gray-500 hover:text-gray-700"
          >
            &larr; Back to Course
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Course Studio</h2>
          <span className="text-sm text-gray-500">{course.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={strictSource}
              onChange={(e) => setStrictSource(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">Strict-source mode</span>
          </label>
          {debugData && (
            <button
              onClick={() => setDebugOpen(!debugOpen)}
              className={`px-3 py-1.5 text-xs rounded-lg border ${
                debugOpen
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                  : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {debugOpen ? 'Close Debug' : 'Debug'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Generate Tab ─── */}
      {activeTab === 'generate' && (
        <div className="max-w-3xl">
          <form onSubmit={handleGenerate} className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Content Title</label>
              <input
                type="text"
                value={genTitle}
                onChange={(e) => setGenTitle(e.target.value)}
                placeholder="e.g., Introduction to Binary Search Trees"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instructions for AI
              </label>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                placeholder="Describe what content you want generated. The AI will use your uploaded source documents as reference material..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                rows={4}
                required
              />
            </div>
            <button
              type="submit"
              disabled={generating}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Draft'}
            </button>
          </form>

          {/* Generated Draft Preview */}
          {generatedDraft && (
            <div className="border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-900">{generatedDraft.title}</h4>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      generatedDraft.status === 'APPROVED'
                        ? 'bg-green-100 text-green-800'
                        : generatedDraft.status === 'REJECTED'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {generatedDraft.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {generatedDraft.status === 'DRAFT' && (
                    <>
                      <button
                        onClick={() => handleApproveDraft(generatedDraft.id, editedContent)}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleRejectDraft(generatedDraft.id)}
                        className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setDebugOpen(true);
                    }}
                    className="px-3 py-1 text-xs bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200"
                  >
                    View Debug
                  </button>
                </div>
              </div>
              <div className="p-4">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  rows={16}
                />
                <p className="text-xs text-gray-400 mt-2">
                  Review and edit the generated content above before approving. This is a DRAFT - it
                  will not be published until you approve it.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Query Tab ─── */}
      {activeTab === 'query' && (
        <div className="max-w-3xl">
          <p className="text-sm text-gray-500 mb-4">
            Ask questions about your source documents. The RAG pipeline will retrieve relevant
            chunks and generate an answer with citations.
          </p>
          <form onSubmit={handleQuery} className="space-y-4 mb-6">
            <textarea
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Ask a question about your course materials..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              rows={3}
              required
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={querying}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {querying ? 'Querying...' : 'Ask Question'}
              </button>
              {debugData && (
                <button
                  type="button"
                  onClick={() => setDebugOpen(true)}
                  className="px-3 py-1.5 text-xs bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200"
                >
                  View Debug
                </button>
              )}
            </div>
          </form>

          {queryAnswer && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Answer</h4>
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                {queryAnswer}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Drafts Tab ─── */}
      {activeTab === 'drafts' && (
        <div className="max-w-4xl">
          {loadingDrafts ? (
            <p className="text-gray-400">Loading drafts...</p>
          ) : drafts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No drafts yet. Generate content from the &quot;Generate Content&quot; tab.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{draft.title}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          draft.status === 'APPROVED'
                            ? 'bg-green-100 text-green-700'
                            : draft.status === 'REJECTED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {draft.status}
                      </span>
                      <span className="text-xs text-gray-400">v{draft.version}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      By {draft.createdBy.name} &middot; {formatDateTimeSGT(draft.createdAt)}
                      {draft.reviewedAt &&
                        ` &middot; Reviewed ${formatDateTimeSGT(draft.reviewedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDraft(draft.id)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      View
                    </button>
                    {draft.status === 'DRAFT' && (
                      <>
                        <button
                          onClick={() => handleApproveDraft(draft.id)}
                          className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded hover:bg-green-200"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectDraft(draft.id)}
                          className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Draft Detail Modal */}
          {selectedDraft && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
              <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <h3 className="font-semibold text-gray-900">{selectedDraft.title}</h3>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        selectedDraft.status === 'APPROVED'
                          ? 'bg-green-100 text-green-700'
                          : selectedDraft.status === 'REJECTED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {selectedDraft.status}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedDraft(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    &times;
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-lg">
                    {selectedDraft.contentMdx}
                  </pre>

                  {selectedDraft.citations && (selectedDraft.citations as any[]).length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">Citations</h4>
                      {(selectedDraft.citations as any[]).map((c: any, i: number) => (
                        <p key={i} className="text-xs text-gray-500">
                          [{i + 1}] {c.documentTitle}
                          {c.pageNumber && `, p.${c.pageNumber}`} - &quot;{c.quote}&quot;
                        </p>
                      ))}
                    </div>
                  )}

                  {selectedDraft.auditLogs.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">LLM Audit Trail</h4>
                      {selectedDraft.auditLogs.map((log) => (
                        <p key={log.id} className="text-xs text-gray-500">
                          {log.action} via {log.model} ({log.promptTokens}+{log.completionTokens}{' '}
                          tokens, {log.durationMs}ms) &middot; {formatDateTimeSGT(log.createdAt)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Audit Logs Tab ─── */}
      {activeTab === 'logs' && (
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">LLM Audit Logs</h3>
            <button
              onClick={fetchLogs}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
            >
              Refresh
            </button>
          </div>

          {loadingLogs ? (
            <p className="text-gray-400">Loading logs...</p>
          ) : auditLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No LLM activity yet.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                      Action
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Model</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                      Tokens
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                      Duration
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Draft</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-100">
                      <td className="px-4 py-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600 font-mono">{log.model}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {log.promptTokens}+{log.completionTokens}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">{log.durationMs}ms</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{log.draft?.title || '-'}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">
                        {formatDateTimeSGT(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RAG Debug Drawer */}
      <RagDebugDrawer data={debugData} isOpen={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  );
}
