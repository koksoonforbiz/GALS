import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { BookOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { SourcesPanel } from '../../components/dialogue/SourcesPanel';
import { ChatPanel } from '../../components/dialogue/ChatPanel';
import { StudioPanel } from '../../components/dialogue/StudioPanel';
import type { StudentSourceDocument } from '../../components/dialogue/SourceCard';
import type { DialogueMessage, DialogueSession } from '../../components/dialogue/ChatPanel';
import type {
  StudioOutput,
  SourceGuide,
  LearningIntervention,
  DialogueCourseSettings,
} from '../../components/dialogue/StudioPanel';
import type { Citation } from '../../components/dialogue/CitationChip';

const PANEL_SIZES_KEY = 'ats:dialogue:panel-sizes';
const DEFAULT_PANEL_SIZES = { left: 22, right: 28 };

interface Course {
  id: string;
  title: string;
  teacherId: string;
  learningMode: string;
  dblSettings: DialogueCourseSettings | null;
}

export function DialogueLearning() {
  const { courseId } = useParams<{ courseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();

  // Core state
  const [course, setCourse] = useState<Course | null>(null);
  const [sessions, setSessions] = useState<DialogueSession[]>([]);
  const [activeSession, setActiveSession] = useState<DialogueSession | null>(null);
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [sources, setSources] = useState<StudentSourceDocument[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set());
  const [studioOutputs, setStudioOutputs] = useState<StudioOutput[]>([]);
  const [selectedSource, setSelectedSource] = useState<StudentSourceDocument | null>(null);
  const [selectedSourceGuide, setSelectedSourceGuide] = useState<SourceGuide | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<'studio' | 'guide' | 'interventions'>(
    'studio',
  );
  const [pastInterventions, setPastInterventions] = useState<LearningIntervention[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [processingDocumentIds, setProcessingDocumentIds] = useState<Set<string>>(new Set());
  const [chatInputOverride, setChatInputOverride] = useState<string | undefined>();
  const [suggestedQuestions, setSuggestedQuestions] = useState<Array<{ question: string }>>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [highlightedExcerpt, setHighlightedExcerpt] = useState<string | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [panelSizes] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_SIZES_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_PANEL_SIZES;
    } catch {
      return DEFAULT_PANEL_SIZES;
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const courseSettings: DialogueCourseSettings = course?.dblSettings || {};

  // ─── Data fetching ────────────────────────────────────────

  useEffect(() => {
    if (!courseId) return;

    const loadData = async () => {
      try {
        const [courseData, sourcesData, sessionsData] = await Promise.all([
          api.get<Course>(`/courses/${courseId}`),
          api.get<StudentSourceDocument[]>(`/student-rag/courses/${courseId}/documents`),
          api.get<DialogueSession[]>(`/dialogue/courses/${courseId}/sessions`),
        ]);

        setCourse(courseData);
        setSources(sourcesData);
        setSessions(sessionsData);

        // Set active sources (all completed documents by default)
        const completedIds = new Set(
          sourcesData.filter((s) => s.processingStatus === 'COMPLETED').map((s) => s.id),
        );
        setActiveSourceIds(completedIds);

        // Restore session from URL param
        const sessionId = searchParams.get('session');
        if (sessionId) {
          const session = sessionsData.find((s) => s.id === sessionId);
          if (session) {
            setActiveSession(session);
            await loadSessionData(session.id);
          }
        } else if (sessionsData.length > 0 && sessionsData[0]) {
          // Load most recent session
          setActiveSession(sessionsData[0]);
          await loadSessionData(sessionsData[0].id);
        }

        // Load first source guide for suggested questions
        const completedSource = sourcesData.find((s) => s.processingStatus === 'COMPLETED');
        if (completedSource) {
          loadSourceGuide(completedSource.id);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to load course data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSessionData = useCallback(async (sessionId: string) => {
    try {
      const [msgs, outputs, interventions] = await Promise.all([
        api.get<DialogueMessage[]>(`/dialogue/sessions/${sessionId}/messages`),
        api.get<StudioOutput[]>(`/dialogue/sessions/${sessionId}/studio`),
        api.get<LearningIntervention[]>(`/dialogue/sessions/${sessionId}/interventions`),
      ]);
      setMessages(msgs);
      setStudioOutputs(outputs);
      setPastInterventions(interventions);
    } catch {
      // Session data may not exist yet
      setMessages([]);
      setStudioOutputs([]);
      setPastInterventions([]);
    }
  }, []);

  const loadSourceGuide = useCallback(async (documentId: string) => {
    try {
      const guide = await api.get<SourceGuide>(`/student-rag/documents/${documentId}/guide`);
      setSelectedSourceGuide(guide);
      if (guide.suggestedQuestions) {
        setSuggestedQuestions(guide.suggestedQuestions.map((q) => ({ question: q })));
      }
    } catch {
      setSelectedSourceGuide(null);
    }
  }, []);

  // ─── WebSocket connection ─────────────────────────────────

  useEffect(() => {
    if (!user || !activeSession) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const token = localStorage.getItem('token');
    const socket = io(`${apiUrl}/dialogue`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });

    socket.emit('join_session', { sessionId: activeSession.id });
    socket.emit('join_student', { studentId: user.id });

    socket.on('processing_update', (payload: { documentId: string; status: string }) => {
      setSources((prev) =>
        prev.map((s) =>
          s.id === payload.documentId ? { ...s, processingStatus: payload.status } : s,
        ),
      );

      if (payload.status === 'COMPLETED') {
        setProcessingDocumentIds((prev) => {
          const next = new Set(prev);
          next.delete(payload.documentId);
          return next;
        });
        setActiveSourceIds((prev) => new Set([...prev, payload.documentId]));
        // Refresh the source to get guide
        loadSourceGuide(payload.documentId);
      }

      if (payload.status === 'FAILED') {
        setProcessingDocumentIds((prev) => {
          const next = new Set(prev);
          next.delete(payload.documentId);
          return next;
        });
      }
    });

    socket.on('message_chunk', (chunk: { content: string }) => {
      // Could be used for streaming - for now we use the complete message
      void chunk;
    });

    return () => {
      socket.disconnect();
    };
  }, [user, activeSession, loadSourceGuide]);

  // ─── Keyboard shortcuts ──────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('[data-dialogue-input]')?.focus();
      }
      if (mod && e.key === 'u') {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      if (mod && e.key === '1') {
        e.preventDefault();
        setRightPanelMode('studio');
      }
      if (mod && e.key === '2') {
        e.preventDefault();
        setRightPanelMode('guide');
      }
      if (mod && e.key === '3') {
        e.preventDefault();
        setRightPanelMode('interventions');
      }
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Persist panel sizes ───────────────────────────────

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(panelSizes));
    } catch {
      // ignore
    }
  }, [panelSizes]);

  // ─── Handlers ─────────────────────────────────────────────

  const handleCreateSession = useCallback(async () => {
    if (!courseId) return;
    try {
      const session = await api.post<DialogueSession>(`/dialogue/courses/${courseId}/sessions`, {
        activeSourceIds: [...activeSourceIds],
      });
      setSessions((prev) => [session, ...prev]);
      setActiveSession(session);
      setMessages([]);
      setStudioOutputs([]);
      setPastInterventions([]);
      setSearchParams({ session: session.id });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [courseId, activeSourceIds, toast, setSearchParams]);

  const handleSelectSession = useCallback(
    async (session: DialogueSession) => {
      setActiveSession(session);
      setSearchParams({ session: session.id });
      await loadSessionData(session.id);
    },
    [loadSessionData, setSearchParams],
  );

  const lastSentContent = useRef<string>('');

  const handleSendMessage = useCallback(
    async (content: string) => {
      setSendError(null);
      lastSentContent.current = content;

      if (!activeSession) {
        // Auto-create session
        if (!courseId) return;
        try {
          const session = await api.post<DialogueSession>(
            `/dialogue/courses/${courseId}/sessions`,
            { activeSourceIds: [...activeSourceIds] },
          );
          setSessions((prev) => [session, ...prev]);
          setActiveSession(session);
          setSearchParams({ session: session.id });

          setIsSending(true);
          const result = await api.post<{
            userMessage: DialogueMessage;
            assistantMessage: DialogueMessage;
          }>(`/dialogue/sessions/${session.id}/messages`, {
            content,
            activeSourceIds: [...activeSourceIds],
          });
          setMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to send');
        } finally {
          setIsSending(false);
        }
        return;
      }

      setIsSending(true);
      try {
        const result = await api.post<{
          userMessage: DialogueMessage;
          assistantMessage: DialogueMessage;
        }>(`/dialogue/sessions/${activeSession.id}/messages`, {
          content,
          activeSourceIds: [...activeSourceIds],
        });
        setMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Failed to send');
      } finally {
        setIsSending(false);
      }
    },
    [activeSession, courseId, activeSourceIds, setSearchParams],
  );

  const handleRetry = useCallback(() => {
    if (lastSentContent.current) {
      handleSendMessage(lastSentContent.current);
    }
  }, [handleSendMessage]);

  const handleToggleSource = useCallback((id: string, active: boolean) => {
    setActiveSourceIds((prev) => {
      const next = new Set(prev);
      active ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const handleSourceSelect = useCallback(
    (source: StudentSourceDocument) => {
      setSelectedSource(source);
      setRightPanelMode('guide');
      if (source.processingStatus === 'COMPLETED') {
        loadSourceGuide(source.id);
      }
    },
    [loadSourceGuide],
  );

  const handleUploadComplete = useCallback((doc: StudentSourceDocument) => {
    setSources((prev) => [doc, ...prev]);
    setProcessingDocumentIds((prev) => new Set([...prev, doc.id]));
  }, []);

  const handleDeleteSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    setActiveSourceIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleCitationClick = useCallback(
    (citation: Citation) => {
      const source = sources.find((s) => s.id === citation.documentId);
      if (source) {
        setSelectedSource(source);
        setRightPanelMode('guide');
        setHighlightedExcerpt(citation.excerpt || null);
        loadSourceGuide(source.id);
      }
    },
    [sources, loadSourceGuide],
  );

  const handleActivateSources = useCallback(() => {
    const completedIds = new Set(
      sources.filter((s) => s.processingStatus === 'COMPLETED').map((s) => s.id),
    );
    setActiveSourceIds(completedIds);
  }, [sources]);

  const handleRetryProcessing = useCallback(
    async (docId: string) => {
      try {
        await api.post(`/student-rag/documents/${docId}/reprocess`, {});
        toast('info', 'Reprocessing document...');
        setProcessingDocumentIds((prev) => new Set([...prev, docId]));
        setSources((prev) =>
          prev.map((s) => (s.id === docId ? { ...s, processingStatus: 'PROCESSING' } : s)),
        );
      } catch {
        toast('error', 'Failed to reprocess document');
      }
    },
    [toast],
  );

  const handleStudioGenerate = useCallback(
    async (type: string, promptHint?: string) => {
      if (!courseId || !activeSession) return;
      try {
        const output = await api.post<StudioOutput>(`/dialogue/courses/${courseId}/studio`, {
          type,
          sourceIds: [...activeSourceIds],
          promptHint,
          sessionId: activeSession.id,
        });
        setStudioOutputs((prev) => [output, ...prev]);
        toast('success', `Generated ${type.replace('_', ' ').toLowerCase()}`);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Generation failed');
      }
    },
    [courseId, activeSession, activeSourceIds, toast],
  );

  const handleSuggestedQuestionClick = useCallback((question: string) => {
    setChatInputOverride(question);
  }, []);

  const handleStartIntervention = useCallback(
    async (type: string) => {
      if (!activeSession) return;
      try {
        const intervention = await api.post<LearningIntervention>(
          `/dialogue/sessions/${activeSession.id}/interventions`,
          {
            type,
            selectedText: 'Based on active student sources',
          },
        );
        setPastInterventions((prev) => [intervention, ...prev]);
        toast('info', `Started ${type.replace('_', ' ').toLowerCase()} session`);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to start intervention');
      }
    },
    [activeSession, toast],
  );

  // ─── Loading state ────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col -m-6">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">
            {course?.title || 'Course'}
          </h1>
          <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 font-medium">
            Dialogue
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Session selector */}
          <select
            value={activeSession?.id || ''}
            onChange={(e) => {
              const session = sessions.find((s) => s.id === e.target.value);
              if (session) handleSelectSession(session);
            }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 max-w-[200px]"
          >
            {sessions.length === 0 && <option value="">No sessions</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreateSession}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            + New Session
          </button>
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            title="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
      </div>

      {/* Hidden file input for Ctrl+U shortcut */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.webp"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            // Trigger upload via SourcesPanel by simulating upload
            const formData = new FormData();
            for (const file of Array.from(e.target.files)) {
              formData.append('file', file);
            }
            // Use the direct upload flow
            Array.from(e.target.files).forEach(async (file) => {
              const fd = new FormData();
              fd.append('file', file);
              const token = localStorage.getItem('token');
              try {
                const res = await fetch(`/api/student-rag/courses/${courseId}/documents`, {
                  method: 'POST',
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                  body: fd,
                });
                if (res.ok) {
                  const doc = await res.json();
                  handleUploadComplete(doc as StudentSourceDocument);
                  toast('success', `Uploaded ${file.name}`);
                }
              } catch {
                toast('error', `Failed to upload ${file.name}`);
              }
            });
            e.target.value = '';
          }
        }}
      />

      {/* Empty state - no sources uploaded */}
      {!isLoading && sources.length === 0 && messages.length === 0 && !activeSession ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6 py-12">
            <div className="text-gray-400 mb-4">
              <BookOpen size={48} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Start Your Learning Space</h2>
            <p className="text-sm text-gray-500 mb-6">
              Upload your study materials to begin. PDFs, documents, images, code — anything.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Upload Your First Document
            </button>
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-400 mb-3">Or try with a quick prompt</p>
              <button
                onClick={() => {
                  setChatInputOverride('What is machine learning?');
                }}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                &quot;What is machine learning?&quot; →
              </button>
              <p className="text-xs text-gray-400 mt-1">(uses fallback mode without sources)</p>
            </div>
          </div>
        </div>
      ) : (
        /* Three-panel layout */
        <div className="flex-1 flex min-h-0">
          {/* Left panel - Sources */}
          <div
            style={{ width: `${panelSizes.left}%` }}
            className="min-w-[200px] max-w-[320px] border-r border-gray-200 bg-white flex-shrink-0"
          >
            <SourcesPanel
              sources={sources}
              activeSourceIds={activeSourceIds}
              courseId={courseId || ''}
              onToggleSource={handleToggleSource}
              onSourceSelect={handleSourceSelect}
              onUploadComplete={handleUploadComplete}
              onDelete={handleDeleteSource}
              processingDocumentIds={processingDocumentIds}
              onRetryProcessing={handleRetryProcessing}
            />
          </div>

          {/* Middle panel - Chat */}
          <div className="flex-1 bg-white min-w-0">
            <ChatPanel
              messages={messages}
              isSending={isSending}
              activeSourceCount={activeSourceIds.size}
              totalSourceCount={sources.length}
              onSend={handleSendMessage}
              onCitationClick={handleCitationClick}
              session={activeSession}
              suggestedQuestions={suggestedQuestions}
              inputOverride={chatInputOverride}
              onInputOverrideUsed={() => setChatInputOverride(undefined)}
              sendError={sendError}
              onRetry={handleRetry}
              onActivateSources={handleActivateSources}
            />
          </div>

          {/* Right panel - Studio/Guide/Interventions */}
          <div
            style={{ width: `${panelSizes.right}%` }}
            className="min-w-[250px] max-w-[400px] border-l border-gray-200 bg-white flex-shrink-0"
          >
            <StudioPanel
              mode={rightPanelMode}
              onModeChange={setRightPanelMode}
              selectedSource={selectedSource}
              selectedSourceGuide={selectedSourceGuide}
              activeSourceIds={[...activeSourceIds]}
              sessionId={activeSession?.id || null}
              courseId={courseId || ''}
              courseSettings={courseSettings}
              studioOutputs={studioOutputs}
              onStudioGenerate={handleStudioGenerate}
              onSuggestedQuestionClick={handleSuggestedQuestionClick}
              pastInterventions={pastInterventions}
              onStartIntervention={handleStartIntervention}
              highlightedExcerpt={highlightedExcerpt}
              onHighlightClear={() => setHighlightedExcerpt(null)}
            />
          </div>
        </div>
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Keyboard Shortcuts</h3>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Ctrl/Cmd + Enter', 'Send message'],
                ['Ctrl/Cmd + K', 'Focus chat input'],
                ['Ctrl/Cmd + U', 'Open upload dialog'],
                ['Ctrl/Cmd + 1', 'Studio tab'],
                ['Ctrl/Cmd + 2', 'Guide tab'],
                ['Ctrl/Cmd + 3', 'Interventions tab'],
                ['?', 'Toggle this help'],
              ].map(([key, desc]) => (
                <div key={key} className="flex justify-between">
                  <kbd className="px-2 py-0.5 text-xs bg-gray-100 border border-gray-200 rounded font-mono">
                    {key}
                  </kbd>
                  <span className="text-gray-600">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
