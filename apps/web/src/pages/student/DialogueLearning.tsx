import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  BookOpen,
  Pencil,
  Check,
  X,
  Trash2,
  Maximize2,
  Minimize2,
  Plus,
  MessageSquare,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { useActivityLog } from '../../lib/activity-log';
import { usePageContext } from '../../contexts/PageContext';
import { SourcesPanel } from '../../components/dialogue/SourcesPanel';
import { ChatPanel } from '../../components/dialogue/ChatPanel';
import { StudioPanel } from '../../components/dialogue/StudioPanel';
import { PdfReaderPanel } from '../../components/dialogue/PdfReaderPanel';
import type {
  InterventionStrategy,
  HighlightEntry,
} from '../../components/dialogue/PdfReaderPanel';
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
  const { track } = useActivityLog();
  const { setPageContext, setSelectedText, clearSelectedText } = usePageContext();

  // Set page context so the floating chatbot knows we're in a course
  useEffect(() => {
    if (courseId) {
      setPageContext({ courseId, pageType: 'lesson' });
    }
  }, [courseId, setPageContext]);

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
  const [rightPanelMode, setRightPanelMode] = useState<
    'studio' | 'guide' | 'interventions' | 'notes'
  >('studio');
  const [pastInterventions, setPastInterventions] = useState<LearningIntervention[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [processingDocumentIds, setProcessingDocumentIds] = useState<Set<string>>(new Set());
  const [chatInputOverride, setChatInputOverride] = useState<string | undefined>();
  const [suggestedQuestions, setSuggestedQuestions] = useState<Array<{ question: string }>>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [highlightedExcerpt, setHighlightedExcerpt] = useState<string | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // PDF reader center panel state
  type CenterPanelMode =
    | { type: 'chat' }
    | { type: 'pdf-reader'; documentId: string; documentName: string; documentUrl: string };
  const [centerPanel, setCenterPanel] = useState<CenterPanelMode>({ type: 'chat' });

  // Intervention prefill from PDF highlight
  interface InterventionPrefill {
    text: string;
    strategy: InterventionStrategy;
    triggeredAt: number;
  }
  const [interventionPrefill, setInterventionPrefill] = useState<InterventionPrefill | null>(null);

  // Notes pending highlight from PDF
  interface PendingHighlight {
    text: string;
    sourceDocumentId: string;
    documentName: string;
    pageNumber?: number;
    color?: string;
  }
  const [pendingHighlight, setPendingHighlight] = useState<PendingHighlight | null>(null);
  const [pdfHighlights, setPdfHighlights] = useState<HighlightEntry[]>([]);
  const [panelSizes] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_SIZES_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_PANEL_SIZES;
    } catch {
      return DEFAULT_PANEL_SIZES;
    }
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(panelSizes.right);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const courseSettings: DialogueCourseSettings = course?.dblSettings || {};

  // ─── Data fetching ────────────────────────────────────────

  useEffect(() => {
    if (!courseId) return;

    const loadData = async () => {
      try {
        const [courseData, sessionsData] = await Promise.all([
          api.get<Course>(`/courses/${courseId}`),
          api.get<DialogueSession[]>(`/dialogue/courses/${courseId}/sessions`),
        ]);

        setCourse(courseData);
        setSessions(sessionsData);

        // Restore session from URL param only — no auto-select.
        // First-time visitors and returning users land on the session picker.
        const sessionId = searchParams.get('session');
        const selectedSession: DialogueSession | null = sessionId
          ? sessionsData.find((s) => s.id === sessionId) || null
          : null;

        if (selectedSession) {
          setActiveSession(selectedSession);
          await loadSessionData(selectedSession.id);
          // Load sources for this session
          const sourcesData = await api.get<StudentSourceDocument[]>(
            `/student-rag/courses/${courseId}/documents?sessionId=${selectedSession.id}`,
          );
          setSources(sourcesData);
          const completedIds = new Set(
            sourcesData.filter((s) => s.processingStatus === 'COMPLETED').map((s) => s.id),
          );
          setActiveSourceIds(completedIds);

          const completedSource = sourcesData.find((s) => s.processingStatus === 'COMPLETED');
          if (completedSource) {
            loadSourceGuide(completedSource.id);
          }
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

  // ─── Right panel resize via drag ──────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const rightEdge = containerRect.right;
      const newWidthPx = rightEdge - ev.clientX;
      const newWidthPercent = (newWidthPx / containerWidth) * 100;
      // Clamp between 15% and 60%
      const clamped = Math.max(15, Math.min(60, newWidthPercent));
      setRightPanelWidth(clamped);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // ─── Handlers ─────────────────────────────────────────────

  // Emit DIALOGUE_SESSION_ENDED when the student leaves an active
  // dialogue session — either switches to a different one or
  // navigates away entirely. Pairs with DIALOGUE_SESSION_STARTED so
  // time-in-session can be derived from start/end timestamps for the
  // teacher's replay tab. Uses a ref so we capture the *previous*
  // session id (the one we're leaving), not the current one.
  const lastActiveSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastActiveSessionRef.current;
    const curr = activeSession?.id ?? null;
    if (prev && prev !== curr) {
      track('DIALOGUE_SESSION_ENDED', {
        dialogueSessionId: prev,
        courseId: courseId ?? undefined,
        metadata: { reason: curr ? 'switched_session' : 'left_dialogue' },
      });
    }
    lastActiveSessionRef.current = curr;
  }, [activeSession?.id, courseId, track]);
  useEffect(() => {
    // Fire on unmount with whatever the final active session was.
    return () => {
      const final = lastActiveSessionRef.current;
      if (final) {
        track('DIALOGUE_SESSION_ENDED', {
          dialogueSessionId: final,
          courseId: courseId ?? undefined,
          metadata: { reason: 'unmount' },
        });
      }
    };
    // Intentionally empty deps — we want this to fire only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateSession = useCallback(async () => {
    if (!courseId) return;
    try {
      const session = await api.post<DialogueSession>(`/dialogue/courses/${courseId}/sessions`, {});
      setSessions((prev) => [session, ...prev]);
      setActiveSession(session);
      setMessages([]);
      setStudioOutputs([]);
      setPastInterventions([]);
      setSources([]);
      setActiveSourceIds(new Set());
      setSearchParams({ session: session.id });
      track('DIALOGUE_SESSION_STARTED', {
        dialogueSessionId: session.id,
        courseId,
        metadata: { summary: 'Started new dialogue session' },
      });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [courseId, toast, setSearchParams, track]);

  const handleSelectSession = useCallback(
    async (session: DialogueSession) => {
      setActiveSession(session);
      setSearchParams({ session: session.id });
      await loadSessionData(session.id);
      // Load session-scoped sources
      if (courseId) {
        try {
          const sourcesData = await api.get<StudentSourceDocument[]>(
            `/student-rag/courses/${courseId}/documents?sessionId=${session.id}`,
          );
          setSources(sourcesData);
          const completedIds = new Set(
            sourcesData.filter((s) => s.processingStatus === 'COMPLETED').map((s) => s.id),
          );
          setActiveSourceIds(completedIds);
        } catch {
          setSources([]);
          setActiveSourceIds(new Set());
        }
      }
    },
    [courseId, loadSessionData, setSearchParams],
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
          track('DIALOGUE_SESSION_STARTED', {
            dialogueSessionId: session.id,
            courseId,
            metadata: { summary: 'Auto-created dialogue session' },
          });
          track('DIALOGUE_MESSAGE_SENT', {
            dialogueSessionId: session.id,
            courseId,
            metadata: { role: 'student', summary: content.slice(0, 80) },
          });
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
        track('DIALOGUE_MESSAGE_SENT', {
          dialogueSessionId: activeSession.id,
          courseId,
          metadata: { role: 'student', summary: content.slice(0, 80) },
        });
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Failed to send');
      } finally {
        setIsSending(false);
      }
    },
    [activeSession, courseId, activeSourceIds, setSearchParams, track],
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

  const handleUploadComplete = useCallback(
    (doc: StudentSourceDocument) => {
      track('STUDY_MATERIAL_UPLOADED', {
        dialogueSessionId: activeSession?.id,
        courseId,
        metadata: {
          documentId: doc.id,
          fileName: doc.originalName,
          summary: `Uploaded ${doc.originalName}`,
        },
      });
      setSources((prev) => {
        const updated = [doc, ...prev];
        // Auto-name session based on uploaded materials if title is still default
        if (activeSession && activeSession.title === 'New Session') {
          const names = updated
            .map((s) => s.originalName.replace(/\.[^.]+$/, '')) // strip extension
            .slice(0, 3);
          const autoTitle =
            names.length <= 2 ? names.join(', ') : `${names[0]}, ${names[1]} +${names.length - 2}`;
          if (autoTitle) {
            api
              .patch(`/dialogue/sessions/${activeSession.id}`, { title: autoTitle })
              .then(() => {
                setActiveSession((prev) => (prev ? { ...prev, title: autoTitle } : prev));
                setSessions((prev) =>
                  prev.map((s) => (s.id === activeSession.id ? { ...s, title: autoTitle } : s)),
                );
              })
              .catch(() => {});
          }
        }
        return updated;
      });
      setProcessingDocumentIds((prev) => new Set([...prev, doc.id]));
    },
    [activeSession, track, courseId],
  );

  const handleDeleteSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    setActiveSourceIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleRenameSession = useCallback(
    async (newTitle: string) => {
      if (!activeSession || !newTitle.trim()) return;
      try {
        await api.patch(`/dialogue/sessions/${activeSession.id}`, { title: newTitle.trim() });
        setActiveSession((prev) => (prev ? { ...prev, title: newTitle.trim() } : prev));
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? { ...s, title: newTitle.trim() } : s)),
        );
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to rename session');
      }
    },
    [activeSession, toast],
  );

  const handleImportDocuments = useCallback(
    async (documentIds: string[]) => {
      if (!courseId || !activeSession) return;
      try {
        await api.post(`/student-rag/courses/${courseId}/documents/import`, {
          documentIds,
          targetSessionId: activeSession.id,
        });
        // Reload sources for current session
        const sourcesData = await api.get<StudentSourceDocument[]>(
          `/student-rag/courses/${courseId}/documents?sessionId=${activeSession.id}`,
        );
        setSources(sourcesData);
        const completedIds = new Set(
          sourcesData.filter((s) => s.processingStatus === 'COMPLETED').map((s) => s.id),
        );
        setActiveSourceIds(completedIds);
        toast('success', `Imported ${documentIds.length} document(s)`);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Import failed');
      }
    },
    [courseId, activeSession, toast],
  );

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

  // ─── PDF Reader handlers ───────────────────────────────

  const fetchPdfHighlights = useCallback(async (sessionId: string) => {
    try {
      const notes = await api.get<
        Array<{
          id: string;
          highlightedText: string | null;
          pageNumber: number | null;
          color: string;
        }>
      >(`/dialogue-notes?sessionId=${sessionId}`);
      setPdfHighlights(
        notes
          .filter((n) => n.highlightedText)
          .map((n) => ({
            id: n.id,
            text: n.highlightedText!,
            pageNumber: n.pageNumber,
            color: n.color,
          })),
      );
    } catch {
      // non-critical
    }
  }, []);

  const handleReadPdf = useCallback(
    async (source: StudentSourceDocument) => {
      try {
        const { url } = await api.get<{ url: string }>(
          `/student-rag/documents/${source.id}/presign`,
        );
        setCenterPanel({
          type: 'pdf-reader',
          documentId: source.id,
          documentName: source.originalName,
          documentUrl: url,
        });
        if (activeSession) {
          fetchPdfHighlights(activeSession.id);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to get PDF URL');
      }
    },
    [toast, activeSession, fetchPdfHighlights],
  );

  const handleSendToIntervention = useCallback(
    (text: string, strategy: InterventionStrategy) => {
      setRightPanelMode('interventions');
      setInterventionPrefill({ text, strategy, triggeredAt: Date.now() });
      toast('info', 'Sending to Learn...');
    },
    [toast],
  );

  const handleSaveHighlightToNotes = useCallback(
    (text: string, pageNumber?: number, color?: string) => {
      if (centerPanel.type !== 'pdf-reader') return;
      setRightPanelMode('notes');
      setPendingHighlight({
        text,
        sourceDocumentId: centerPanel.documentId,
        documentName: centerPanel.documentName,
        pageNumber,
        color,
      });
      toast('info', 'Saving to Notes...');
    },
    [centerPanel, toast, activeSession, fetchPdfHighlights],
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
        track('STUDIO_OUTPUT_REQUESTED', {
          dialogueSessionId: activeSession.id,
          courseId,
          metadata: { type, summary: `Generated ${type.replace('_', ' ').toLowerCase()}` },
        });
        toast('success', `Generated ${type.replace('_', ' ').toLowerCase()}`);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Generation failed');
      }
    },
    [courseId, activeSession, activeSourceIds, toast, track],
  );

  const handleStudioDelete = useCallback(
    async (outputId: string) => {
      try {
        await api.delete(`/dialogue/studio/${outputId}`);
        setStudioOutputs((prev) => prev.filter((o) => o.id !== outputId));
        toast('success', 'Output deleted');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [toast],
  );

  const handleSuggestedQuestionClick = useCallback((question: string) => {
    setChatInputOverride(question);
  }, []);

  const handleStartIntervention = useCallback(
    async (type: string) => {
      if (!activeSession) return;
      // Capture any text the user has selected on the page
      const selectedText =
        window.getSelection()?.toString().trim() || 'Based on active student sources';
      try {
        const intervention = await api.post<LearningIntervention>(
          `/dialogue/sessions/${activeSession.id}/interventions`,
          {
            type,
            selectedText,
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

  const handleSaveForReview = useCallback(
    async (data: {
      interventionId: string;
      interventionType: string;
      title: string;
      selectedText: string;
      savedData: Record<string, unknown>;
    }) => {
      try {
        await api.post('/learning-interventions/saved-reviews', {
          ...data,
          courseId: courseId || '',
          contentId: undefined,
          pageType: 'dialogue',
        });
        toast('success', 'Saved to Review Queue');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to save review');
      }
    },
    [courseId, toast],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await api.delete(`/dialogue/sessions/${sessionId}`);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSession?.id === sessionId) {
          setActiveSession(null);
          setMessages([]);
          setStudioOutputs([]);
          setPastInterventions([]);
          setSources([]);
          setActiveSourceIds(new Set());
          setSearchParams({});
        }
        toast('success', 'Session deleted');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to delete session');
      }
    },
    [activeSession, toast, setSearchParams],
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
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 max-w-[160px]"
          >
            {sessions.length === 0 && <option value="">No sessions</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {/* Inline rename */}
          <SessionRenameButton title={activeSession?.title || ''} onRename={handleRenameSession} />
          {activeSession && (
            <button
              onClick={() => {
                if (window.confirm('Delete this session? This cannot be undone.')) {
                  handleDeleteSession(activeSession.id);
                }
              }}
              className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
              title="Delete session"
            >
              <Trash2 size={14} />
            </button>
          )}
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
            // Uploads always happen inside an active session
            if (!activeSession) {
              toast('error', 'Start or select a session before uploading materials');
              e.target.value = '';
              return;
            }
            Array.from(e.target.files).forEach(async (file) => {
              const fd = new FormData();
              fd.append('file', file);
              const token = localStorage.getItem('token');
              try {
                const res = await fetch(
                  `/api/student-rag/courses/${courseId}/documents?sessionId=${activeSession.id}`,
                  {
                    method: 'POST',
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    body: fd,
                  },
                );
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

      {/* Session picker - shown whenever no session is active */}
      {!activeSession ? (
        <SessionPicker
          sessions={sessions}
          onCreate={handleCreateSession}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
        />
      ) : (
        /* Three-panel layout */
        <div ref={containerRef} className="flex-1 flex min-h-0">
          {/* Left panel - Sources */}
          <div
            style={{ width: `${panelSizes.left}%` }}
            className="min-w-[200px] max-w-[320px] border-r border-gray-200 bg-white flex-shrink-0"
          >
            <SourcesPanel
              sources={sources}
              activeSourceIds={activeSourceIds}
              courseId={courseId || ''}
              sessionId={activeSession?.id || null}
              onToggleSource={handleToggleSource}
              onSourceSelect={handleSourceSelect}
              onUploadComplete={handleUploadComplete}
              onDelete={handleDeleteSource}
              onImport={handleImportDocuments}
              processingDocumentIds={processingDocumentIds}
              onRetryProcessing={handleRetryProcessing}
              onReadPdf={handleReadPdf}
            />
          </div>

          {/* Middle panel - Chat or PDF Reader */}
          <div className={`bg-white min-w-0 ${rightPanelExpanded ? 'hidden' : 'flex-1'}`}>
            {centerPanel.type === 'chat' ? (
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
            ) : (
              <PdfReaderPanel
                documentId={centerPanel.documentId}
                documentName={centerPanel.documentName}
                documentUrl={centerPanel.documentUrl}
                onClose={() => {
                  setCenterPanel({ type: 'chat' });
                  clearSelectedText();
                }}
                onSendToIntervention={handleSendToIntervention}
                onSaveHighlightToNotes={handleSaveHighlightToNotes}
                highlights={pdfHighlights}
                onPageHighlighted={(text) => (text ? setSelectedText(text) : clearSelectedText())}
              />
            )}
          </div>

          {/* Drag handle between chat and right panel */}
          {!rightPanelExpanded && (
            <div
              onMouseDown={handleDragStart}
              className="w-1 hover:w-1.5 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors flex-shrink-0 relative group"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          )}

          {/* Right panel - Studio/Guide/Interventions */}
          <div
            style={rightPanelExpanded ? { flex: 1 } : { width: `${rightPanelWidth}%` }}
            className={`border-l border-gray-200 bg-white flex-shrink-0 flex flex-col ${rightPanelExpanded ? '' : 'min-w-[250px] max-w-[50%]'}`}
          >
            {/* Expand/Collapse button */}
            <div className="flex items-center justify-end px-2 py-1 border-b border-gray-100 flex-shrink-0">
              <button
                onClick={() => setRightPanelExpanded((prev) => !prev)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={rightPanelExpanded ? 'Restore panel size' : 'Expand panel'}
              >
                {rightPanelExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
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
              onStudioDelete={handleStudioDelete}
              onSuggestedQuestionClick={handleSuggestedQuestionClick}
              pastInterventions={pastInterventions}
              onStartIntervention={handleStartIntervention}
              highlightedExcerpt={highlightedExcerpt}
              onHighlightClear={() => setHighlightedExcerpt(null)}
              onSaveForReview={handleSaveForReview}
              interventionPrefill={interventionPrefill}
              onInterventionPrefillConsumed={() => setInterventionPrefill(null)}
              pendingHighlight={pendingHighlight}
              onPendingHighlightConsumed={() => setPendingHighlight(null)}
              onNotesChanged={() => {
                if (activeSession) fetchPdfHighlights(activeSession.id);
              }}
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

// ─── Session Picker ─────────────────────────────────────

function SessionPicker({
  sessions,
  onCreate,
  onSelect,
  onDelete,
}: {
  sessions: DialogueSession[];
  onCreate: () => Promise<void> | void;
  onSelect: (session: DialogueSession) => Promise<void> | void;
  onDelete: (sessionId: string) => Promise<void> | void;
}) {
  const formatRelative = (iso: string) => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString();
  };

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-6 py-12">
          <div className="text-gray-400 mb-4 flex justify-center">
            <BookOpen size={48} />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Welcome to your learning space
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Start a session to begin chatting with your materials. You can upload PDFs, documents,
            or images once you're inside.
          </p>
          <button
            onClick={() => onCreate()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Your sessions</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <button
            onClick={() => onCreate()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            Start New Session
          </button>
        </div>
        <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {sessions.map((s) => {
            const messageCount = s._count?.messages ?? 0;
            return (
              <li key={s.id} className="group">
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <button onClick={() => onSelect(s)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={14} className="text-gray-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {s.title || 'Untitled session'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>
                        {messageCount} message{messageCount === 1 ? '' : 's'}
                      </span>
                      <span>·</span>
                      <span>Updated {formatRelative(s.updatedAt)}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Delete this session? This cannot be undone.')) {
                        onDelete(s.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1.5 rounded transition-all"
                    title="Delete session"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─── Session Rename Button ──────────────────────────────

function SessionRenameButton({
  title,
  onRename,
}: {
  title: string;
  onRename: (newTitle: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(title);
  }, [title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-gray-400 hover:text-gray-600 p-1 rounded"
        title="Rename session"
      >
        <Pencil size={14} />
      </button>
    );
  }

  const handleSave = async () => {
    if (value.trim() && value.trim() !== title) {
      await onRename(value.trim());
    }
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="text-xs border border-blue-400 rounded px-2 py-1 w-[160px] focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <button onClick={handleSave} className="text-green-600 hover:text-green-700 p-0.5">
        <Check size={14} />
      </button>
      <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 p-0.5">
        <X size={14} />
      </button>
    </div>
  );
}
