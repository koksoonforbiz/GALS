import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageContext } from '../../contexts/PageContext';
import { useActivityLog } from '../../lib/activity-log';
import { api } from '../../lib/api';

const CodeQuestionMessage = lazy(() =>
  import('../code-practice/CodeQuestionMessage').then((m) => ({
    default: m.CodeQuestionMessage,
  })),
);

/**
 * Strip HTML tags from a string. Keeps text content of the elements but
 * drops `<p>`, `<h1>`, etc. and any attributes. Decodes a few common HTML
 * entities so the output reads naturally to the LLM.
 */
function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/?[A-Za-z][\w.-]*[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Walk a BlockDocument JSON value (the shape the AI generator writes into
 * `contentMdx`: `{ version: 2, blocks: [{ type, data: { html, ... }, ... }] }`)
 * and extract human-readable text from every block. Falls back to scanning
 * arbitrary object trees for `html` / `text` / `caption` string fields so
 * we tolerate block schema drift without producing garbage.
 */
function extractTextFromBlockDocument(doc: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if (t) parts.push(t);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      // Common text-bearing fields in our block schema. Prioritise html
      // so we strip tags below; fall back to plain-text equivalents.
      const textFields = [
        'html',
        'text',
        'caption',
        'problem',
        'solution',
        'misconception',
        'correction',
        'question',
        'answer',
        'explanation',
      ];
      for (const f of textFields) {
        if (typeof o[f] === 'string') {
          parts.push(stripHtmlToText(o[f] as string));
        }
      }
      // Recurse into data + nested arrays/objects (skip the metadata/id
      // bookkeeping fields entirely so we don't leak block ids etc.).
      const skip = new Set(['id', 'metadata', 'generationJobId', 'generatedBy', 'version']);
      for (const [k, v] of Object.entries(o)) {
        if (skip.has(k)) continue;
        if (textFields.includes(k)) continue; // already handled above
        if (typeof v === 'object' && v !== null) visit(v);
      }
    }
  };
  visit(doc);
  return parts
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Best-effort page content → plain-text conversion for the "use entire page"
 * intervention fallback. Handles two formats the platform actually uses:
 *  - BlockDocument JSON (AI-generated lessons: `{ version, blocks: [...] }`)
 *    — parse and walk, pulling text/html out of every block
 *  - Real MDX (legacy / hand-authored): strip `<Component/>` tags,
 *    curly-brace expressions, imports, markdown markers
 * Returns the cleanest plain text we can produce. Crucially, on the JSON
 * path we DO NOT run the MDX regex passes — those treat `{...}` as JSX
 * expressions and butcher the JSON, producing fragments like
 * `,"metadata":}` that confuse the LLM.
 */
function stripMdxToPlainText(mdx: string): string {
  if (!mdx) return '';

  // Try JSON block document first — that's what AI-generated pages store.
  const trimmed = mdx.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const text = extractTextFromBlockDocument(parsed);
      if (text.length > 0) return text;
    } catch {
      // Not valid JSON — fall through to the MDX path.
    }
  }

  let s = mdx;
  // Drop import / export statements (frontmatter-style top blocks).
  s = s.replace(/^(?:import|export)\s+[^\n]+\n/gm, '');
  // Drop JSX element tags (`<Foo bar="..." />`, `<Foo>`, `</Foo>`) but keep
  // the inner text. We strip just the angle-bracketed pieces.
  s = s.replace(/<\/?[A-Za-z][\w.-]*[^>]*>/g, '');
  // Drop curly-brace JS expressions: `{ foo.bar }`, `{value}`. Keep
  // multi-line ones too (non-greedy, with newlines).
  s = s.replace(/\{[\s\S]*?\}/g, '');
  // Drop markdown link / image syntax — keep the visible label.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Drop heading hashes, list markers, blockquote angles, code fences.
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^[*\-+]\s+/gm, '');
  s = s.replace(/^>\s+/gm, '');
  s = s.replace(/^```[\s\S]*?```$/gm, '');
  // Collapse runs of whitespace.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
import { ChatMessageContent } from '../ChatMessageContent';
import { ReviewTabView } from './ReviewTabView';
import { PracticeTestingView } from './interventions/PracticeTestingView';
import { InterrogativeElaborationView } from './interventions/InterrogativeElaborationView';
import { StepwiseLearningView } from './interventions/StepwiseLearningView';
import { CodeDecompositionView } from './interventions/CodeDecompositionView';
import { DistributedPracticeView } from './interventions/DistributedPracticeView';
import type { ChatbotMode, ChatMessage, SaveForReviewInput } from './types';
import {
  GraduationCap,
  BookOpen,
  TextSelect,
  Clock,
  BookMarked,
  SendHorizontal,
  Minus,
  Maximize2,
  Minimize2,
  X,
  FlaskConical,
  Layers,
  Footprints,
  MessageCircleQuestion,
  Loader,
  ArrowLeft,
  Zap,
  Sparkles,
} from 'lucide-react';

const STRATEGY_META: Record<
  string,
  { label: string; mode: ChatbotMode; icon: React.ReactNode; description: string }
> = {
  PRACTICE_TESTING: {
    label: 'Practice Testing',
    mode: 'practice-testing',
    icon: <FlaskConical size={12} />,
    description: 'Test your knowledge with quiz questions',
  },
  DISTRIBUTED_PRACTICE: {
    label: 'Distributed Practice',
    mode: 'distributed-practice',
    icon: <Layers size={12} />,
    description: 'Create flashcards for spaced repetition',
  },
  STEPWISE_LEARNING: {
    label: 'Stepwise Learning',
    mode: 'stepwise-learning',
    icon: <Footprints size={12} />,
    description: 'Break it down into guided steps',
  },
  INTERROGATIVE_ELABORATION: {
    label: 'Interrogative Elaboration',
    mode: 'interrogative-elaboration',
    icon: <MessageCircleQuestion size={12} />,
    description: 'Explore why and how through Q&A',
  },
};

interface ChatbotPanelProps {
  /**
   * Optional minimize / maximize handlers. Only the floating wrapper
   * provides these; the docked variant on StudentCourseViewPage leaves
   * them undefined and the corresponding header buttons disappear.
   */
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  /** Called when the user clicks "Clear" so the PDF page checkboxes can be reset. */
  onClearAllHighlights?: () => void;
  /**
   * Called just before a strategy launches. Sends pending image slides to VLM
   * and returns the resolved selectedText, or null if nothing changed.
   */
  resolveVlmSlides?: () => Promise<string | null>;
}

export function ChatbotPanel({
  onMinimize,
  onToggleMaximize,
  isMaximized = false,
  onClearAllHighlights,
  resolveVlmSlides,
}: ChatbotPanelProps) {
  const {
    pageType,
    courseId,
    contentId,
    contentTitle,
    contentText,
    selectedText,
    sourceDocumentId,
    pdfCurrentPage,
    codeContext,
    activeCodeQuestion,
    setSelectedText,
    clearSelectedText,
    setCodeContext,
    setActiveCodeQuestion,
  } = usePageContext();
  const { track, sessionId, flush: flushActivityLog } = useActivityLog();

  const navigate = useNavigate();

  // Persist chatbot history in sessionStorage so closing/reopening the
  // floating panel doesn't wipe the conversation. Keyed by sessionId so
  // a new login starts fresh and different students never see each
  // other's messages.
  const storageKey = sessionId ? `chatbot_history_${sessionId}` : null;

  const [mode, setMode] = useState<ChatbotMode>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!storageKey) return [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<ChatMessage & { timestamp: string }>;
      // Rehydrate Date objects from the JSON string form.
      return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
    } catch {
      return [];
    }
  });
  // Persist on every change. Cheap because sessionStorage is sync and
  // chat history rarely exceeds a few KB.
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Quota errors or sessionStorage unavailable — non-fatal.
    }
  }, [messages, storageKey]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isResolvingVlm, setIsResolvingVlm] = useState(false);
  const [isCheckingStepwiseCourse, setIsCheckingStepwiseCourse] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dueCount, setDueCount] = useState(0);
  const [pendingStrategy, setPendingStrategy] = useState<ChatbotMode | null>(null);
  const [pregenReady, setPregenReady] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Save-for-Review Handler ──────────────────────────────
  const handleSaveForReview = useCallback(
    async (data: SaveForReviewInput) => {
      setSaveStatus('saving');
      try {
        await api.post('/learning-interventions/saved-reviews', {
          ...data,
          courseId: courseId || '',
          contentId: contentId || undefined,
          pageType,
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [courseId, contentId, pageType],
  );

  // Fetch due cards count
  useEffect(() => {
    api
      .get<{ dueToday: number }>('/learning-interventions/distributed-practice/stats')
      .then((stats) => setDueCount(stats.dueToday))
      .catch(() => {});
  }, [mode]);

  // Fetch pre-generation readiness when document/page changes
  useEffect(() => {
    if (!sourceDocumentId || pdfCurrentPage == null) {
      setPregenReady({});
      return;
    }
    api
      .get<Record<string, boolean>>(
        `/pre-generation/ready?documentId=${sourceDocumentId}&pageNumber=${pdfCurrentPage}`,
      )
      .then((r) => setPregenReady(r))
      .catch(() => setPregenReady({}));
  }, [sourceDocumentId, pdfCurrentPage]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // `overrideText` lets a caller send a specific message without going
  // through the input box first — used by the temporary "Test: Generate
  // Coding Question" button below. Normal typed sends omit it and fall
  // back to `inputValue`. Returns whether the reply included a
  // generated code question, so that same test button can jump straight
  // into the DBox view afterward instead of leaving the student to find
  // and click "Step" themselves.
  const handleSend = async (overrideText?: string): Promise<boolean> => {
    const textToSend = overrideText ?? inputValue;
    if (!textToSend.trim() || isSending) return false;

    // Resolve VLM descriptions for any checked image slides so the chat
    // call has the same slide context as the strategy buttons.
    let effectiveSelectedText = selectedText;
    if (resolveVlmSlides) {
      setIsResolvingVlm(true);
      try {
        const resolved = await resolveVlmSlides();
        if (resolved) effectiveSelectedText = resolved;
      } finally {
        setIsResolvingVlm(false);
      }
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsSending(true);

    // Log the outbound chat message to activity log so the teacher's
    // replay timeline shows the student's chatbot conversation. Without
    // this, standard-mode chatbot interactions never appeared in replay
    // (only dialogue-mode messages were tracked).
    track('CHATBOT_MESSAGE_SENT', {
      courseId: courseId ?? undefined,
      moduleItemId: contentId ?? undefined,
      metadata: {
        message: userMsg.content.slice(0, 1000),
        hasSelection: Boolean(selectedText && selectedText.length >= 20),
        selectionLength: selectedText?.length ?? 0,
        contentTitle: contentTitle ?? null,
        pageType,
      },
    });
    // Push immediately so the teacher's conversation/text-mining view sees
    // this message without waiting for the 30s buffer flush. Best-effort;
    // a failure here just defers persistence to the next timer tick.
    void flushActivityLog();

    if (!courseId) {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Please navigate to a course first so I can help you with your learning!',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsSending(false);
      return false;
    }

    try {
      // The visible bubble for a code-question reply is deliberately a
      // short acknowledgement (the widget carries the real content — see
      // the codePracticeInstruction on the backend), but the LLM still
      // needs to know what the exercise actually was for follow-ups like
      // "what's the answer?". Expand it here, in the history sent to the
      // backend only — never in what's rendered on screen.
      const conversationHistory = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content:
          m.role === 'assistant' && m.codeQuestion
            ? `${m.content}\n\n(Generated coding exercise — question: "${m.codeQuestion.question}". Starter code:\n${m.codeQuestion.starterCode})`
            : m.content,
      }));

      const result = await api.post<{
        reply: string;
        suggestedStrategy: string | null;
        codeQuestion: { question: string; starterCode: string; language: string } | null;
      }>('/learning-interventions/chat', {
        message: textToSend,
        conversationHistory,
        courseId,
        pageType,
        contentId: contentId || undefined,
        contentTitle: contentTitle || undefined,
        selectedText: effectiveSelectedText || undefined,
        // Bug 1/5/6 (2026-06-12): tell the backend which PDF slide the
        // student is currently viewing so chat() can narrow the
        // grounded PDF text to a small window around it. Without this,
        // the LLM saw the full 50KB cap and answered about slide 1.
        // Undefined for non-PDF surfaces (PAGE-type lessons), which
        // the backend treats as a request for full-document context.
        currentPage:
          typeof pdfCurrentPage === 'number' && pdfCurrentPage > 0 ? pdfCurrentPage : undefined,
        codeContext: codeContext || undefined,
        activeCodeQuestion: activeCodeQuestion || undefined,
      });

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.reply,
        timestamp: new Date(),
        suggestedStrategy: result.suggestedStrategy || undefined,
        codeQuestion: result.codeQuestion || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (result.codeQuestion) {
        setCodeContext(null);
        setActiveCodeQuestion(result.codeQuestion);
      }
      track('CHATBOT_MESSAGE_RECEIVED', {
        courseId,
        moduleItemId: contentId ?? undefined,
        metadata: {
          reply: result.reply.slice(0, 1000),
          suggestedStrategy: result.suggestedStrategy ?? null,
          contentTitle: contentTitle ?? null,
        },
      });
      void flushActivityLog();
      return Boolean(result.codeQuestion);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          "Sorry, I couldn't process your message. Try selecting some text and using a learning strategy instead!",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const handleInterventionClick = async (type: ChatbotMode) => {
    if (!courseId) return;

    // Resolve VLM descriptions for any checked image slides before launching
    // (also feeds the coding-course check below, so the exercise it
    // generates can be scoped to whatever's actually highlighted).
    let effectiveSelectedText = selectedText;
    if (resolveVlmSlides) {
      setIsResolvingVlm(true);
      try {
        const resolved = await resolveVlmSlides();
        if (resolved) effectiveSelectedText = resolved;
      } finally {
        setIsResolvingVlm(false);
      }
    }

    // "Step" launches DBox (code decomposition) instead of the regular
    // reading-comprehension stepwise flow whenever the course is
    // actually about programming — re-checked on every click rather than
    // trusting leftover `activeCodeQuestion` state, which used to get
    // stuck pointing at whatever question was generated earliest in the
    // session even after navigating to unrelated, non-coding material.
    if (type === 'stepwise-learning') {
      setIsCheckingStepwiseCourse(true);
      try {
        const check = await api.post<
          | { isCoding: false }
          | { isCoding: true; question: string; starterCode: string; language: string }
        >('/learning-interventions/stepwise-learning/course-check', {
          courseId,
          selectedText: effectiveSelectedText || undefined,
        });
        if (check.isCoding) {
          setCodeContext(null);
          setActiveCodeQuestion({
            question: check.question,
            starterCode: check.starterCode,
            language: check.language,
          });
          setMode('stepwise-learning');
          return;
        }
        // Not a coding course — clear any stale coding question from
        // earlier in the session so it can't leak into this course's
        // Step flow, then fall through to the normal path below.
        setActiveCodeQuestion(null);
      } catch {
        // Check failed — fall through to the normal reading-comprehension
        // flow rather than blocking the button entirely.
      } finally {
        setIsCheckingStepwiseCourse(false);
      }
    }

    if (effectiveSelectedText) {
      setMode(type);
    } else {
      setPendingStrategy(type);
    }
  };

  const handleUseEntirePage = () => {
    if (!pendingStrategy) return;
    // Previously this set `selectedText = contentText` (raw MDX), which
    // sent the LLM a wall of `<Component>` tags + curly braces + import
    // statements. The LLM treated that markup as the content and
    // produced noise about syntax — what users perceived as "random
    // output". Strip to plain text first; if there's nothing extractable
    // (PDF page, missing contentMdx) clear instead so the backend's
    // Q2 RAG resolver fires against the course's uploaded materials.
    const plain = stripMdxToPlainText(contentText ?? '');
    if (plain.trim().length >= 20) {
      setSelectedText(plain);
    } else {
      clearSelectedText();
    }
    setTimeout(() => {
      setMode(pendingStrategy);
      setPendingStrategy(null);
    }, 50);
  };

  const handleDismissPrompt = () => {
    setPendingStrategy(null);
  };

  const handleBackToChat = () => {
    setMode('chat');
  };

  // ─── Review Tab Mode ────────────────────────────────────
  if (mode === 'review-tab') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={true}
        />
        <ReviewTabView onBack={handleBackToChat} />
      </div>
    );
  }

  // ─── Practice Testing Mode ──────────────────────────────
  if (mode === 'practice-testing') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <StrategyBackBar label="Practice Testing" onBack={handleBackToChat} />
        <PracticeTestingView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          documentId={sourceDocumentId}
          pageNumber={pdfCurrentPage}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Interrogative Elaboration Mode ─────────────────────
  if (mode === 'interrogative-elaboration') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <StrategyBackBar label="Interrogative Elaboration" onBack={handleBackToChat} />
        <InterrogativeElaborationView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          documentId={sourceDocumentId}
          pageNumber={pdfCurrentPage}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Stepwise Learning Mode ─────────────────────────────
  if (mode === 'stepwise-learning') {
    // DBox lives here now: handleInterventionClick checks whether the
    // current course is programming-focused on every "Step" click and,
    // if so, sets activeCodeQuestion to a freshly generated exercise
    // (clearing it otherwise) — so this reflects the CURRENT course, not
    // whatever question happened to exist earliest in the session.
    if (activeCodeQuestion) {
      return (
        <div className="flex flex-col h-full bg-white">
          <PanelHeader
            onMinimize={onMinimize}
            onToggleMaximize={onToggleMaximize}
            isMaximized={isMaximized}
            onReviewTab={() => setMode('review-tab')}
            isReviewTab={false}
          />
          <StrategyBackBar label="Stepwise Learning" onBack={handleBackToChat} />
          {/* key forces a full remount whenever the active question
              changes — without it, React reuses the same component
              instance across two different generated questions and none
              of its internal state (the editor's `code`, and
              DecompositionPanel's whole session) resets, so a stale
              tree from the previous question stays on screen. */}
          <CodeDecompositionView
            key={activeCodeQuestion.question}
            question={activeCodeQuestion.question}
            starterCode={activeCodeQuestion.starterCode}
          />
        </div>
      );
    }

    // Check for resumable session
    let resumeSessionId: string | null = null;
    try {
      const stored = localStorage.getItem(`stepwise_session_${courseId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Only resume if less than 24 hours old
        if (parsed?.sessionId && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          resumeSessionId = parsed.sessionId;
        } else {
          localStorage.removeItem(`stepwise_session_${courseId}`);
        }
      }
    } catch {
      // ignore localStorage errors
    }

    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <StrategyBackBar label="Stepwise Learning" onBack={handleBackToChat} />
        <StepwiseLearningView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          documentId={sourceDocumentId}
          pageNumber={pdfCurrentPage}
          resumeSessionId={resumeSessionId}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Distributed Practice Mode ──────────────────────────
  if (mode === 'distributed-practice') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <StrategyBackBar label="Distributed Practice" onBack={handleBackToChat} />
        <DistributedPracticeView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          documentId={sourceDocumentId}
          pageNumber={pdfCurrentPage}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Chat Mode ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white">
      <PanelHeader
        onMinimize={onMinimize}
        onToggleMaximize={onToggleMaximize}
        isMaximized={isMaximized}
        onReviewTab={() => setMode('review-tab')}
        isReviewTab={false}
      />

      {/* Selected text banner */}
      {selectedText && (
        <div className="px-3 py-1.5 border-b border-yellow-200 bg-yellow-50 flex items-center gap-2 text-xs">
          <span className="text-gray-600 truncate flex-1 inline-flex items-center gap-1">
            <TextSelect size={14} className="shrink-0" />
            &quot;{selectedText.slice(0, 60)}
            {selectedText.length > 60 ? '...' : ''}&quot;
          </span>
          <button
            onClick={() => {
              clearSelectedText();
              onClearAllHighlights?.();
            }}
            className="text-gray-400 hover:text-gray-600 whitespace-nowrap"
          >
            Clear
          </button>
        </div>
      )}

      {/* Due cards banner */}
      {dueCount > 0 && (
        <button
          onClick={() => navigate('/student/review-queue')}
          className="w-full px-3 py-1.5 border-b border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 transition-colors text-left flex items-center gap-2"
        >
          <Clock size={14} />
          <span>
            You have {dueCount} card{dueCount !== 1 ? 's' : ''} due!
          </span>
          <span className="ml-auto text-blue-500">Go to Review Queue &rarr;</span>
        </button>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">
            <div className="mb-2 flex justify-center">
              <GraduationCap size={28} className="text-gray-400" />
            </div>
            <p>Hi! I&apos;m your learning assistant.</p>
            <p className="mt-1">
              Ask me anything about your course material, or select text to use a learning strategy.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id}>
              <div
                className={`flex min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] min-w-0 overflow-hidden px-3 py-2 rounded-lg text-xs ${
                    msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {msg.role === 'user' ? (
                    /* User bubbles render verbatim — no markdown / math
                       parsing on the student's own input. Preserves
                       newlines and avoids accidental rendering of
                       user-typed markup. */
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  ) : (
                    /* `min-w-0` + `overflow-hidden` on the bubble are
                       what let the KaTeX overflow CSS in index.css
                       actually take effect — without them, the
                       inline-block math forces the bubble to grow past
                       80% of the column. */
                    <ChatMessageContent content={msg.content} className="text-xs" />
                  )}
                </div>
              </div>
              {/* Inline code question — the LLM decided this message was
                  a request for a coding exercise. Runs entirely
                  client-side via Pyodide; there's no grading, so
                  reporting a run just updates PageContext.codeContext for
                  the next turn (shared with the Playground). */}
              {msg.role === 'assistant' && msg.codeQuestion && (
                <div className="flex justify-start mt-1.5">
                  <div className="max-w-[95%] w-full min-w-0 overflow-hidden px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-800">
                    <Suspense fallback={<div className="text-gray-400">Loading code editor…</div>}>
                      <CodeQuestionMessage
                        question={msg.codeQuestion.question}
                        starterCode={msg.codeQuestion.starterCode}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
              {/* Strategy suggestion card */}
              {msg.suggestedStrategy && STRATEGY_META[msg.suggestedStrategy] && (
                <div className="flex justify-start mt-1.5">
                  <button
                    onClick={() => {
                      const meta = STRATEGY_META[msg.suggestedStrategy!];
                      if (meta && courseId) {
                        handleInterventionClick(meta.mode);
                      }
                    }}
                    disabled={!courseId}
                    className={`max-w-[80%] flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                      courseId
                        ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
                        : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {STRATEGY_META[msg.suggestedStrategy]!.icon}
                    <div className="text-left">
                      <div className="font-medium">
                        Try: {STRATEGY_META[msg.suggestedStrategy]!.label}
                      </div>
                      <div className="text-[10px] opacity-75">
                        {STRATEGY_META[msg.suggestedStrategy]!.description}
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        {/* Typing indicator */}
        {isSending && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-500 flex items-center gap-1.5">
              <Loader size={12} className="animate-spin" />
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Choice prompt when strategy clicked without selected text */}
      {pendingStrategy && (
        <div className="px-3 py-2.5 border-t border-blue-200 bg-blue-50">
          <div className="text-xs font-medium text-blue-800 mb-2">
            How would you like to apply {STRATEGY_META[pendingStrategy]?.label || 'this strategy'}?
          </div>
          <div className="flex flex-col gap-1.5">
            {/* Show "use entire page" whenever we're on a lesson — for
                PAGE-type items the handler extracts text from contentText,
                for PDF-type items it clears selection and lets the backend
                find the matching source PDF via contentId. */}
            {(contentText || contentId) && (
              <button
                onClick={handleUseEntirePage}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-2"
              >
                <BookOpen size={14} />
                <div>
                  <div className="font-medium">Use entire page content</div>
                  <div className="text-[10px] text-blue-500">
                    Apply to the full lesson on this page
                  </div>
                </div>
              </button>
            )}
            <button
              onClick={handleDismissPrompt}
              className="w-full text-left text-xs px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-2"
            >
              <TextSelect size={14} />
              <div>
                <div className="font-medium">Select specific text first</div>
                <div className="text-[10px] text-blue-500">
                  Highlight text on the page, then try again
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Intervention buttons (always visible) */}
      {!pendingStrategy && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
          {isResolvingVlm ? (
            <div className="flex items-center gap-2 text-xs text-amber-700 py-1">
              <Loader size={12} className="animate-spin" />
              Describing image slides…
            </div>
          ) : isCheckingStepwiseCourse ? (
            <div className="flex items-center gap-2 text-xs text-amber-700 py-1">
              <Loader size={12} className="animate-spin" />
              Checking course type…
            </div>
          ) : (
            <>
              <div className="text-xs text-gray-500 mb-1.5">Apply learning strategy:</div>
              {!courseId && (
                <div className="text-[10px] text-amber-600 mb-1">
                  Navigate to a course to use learning strategies.
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <InterventionButton
                  label="Practice"
                  icon={<FlaskConical size={12} />}
                  onClick={() => void handleInterventionClick('practice-testing')}
                  disabled={!courseId}
                  ready={sourceDocumentId ? pregenReady['practice-testing'] : undefined}
                />
                <InterventionButton
                  label="Distributed"
                  icon={<Layers size={12} />}
                  onClick={() => void handleInterventionClick('distributed-practice')}
                  disabled={!courseId}
                  ready={sourceDocumentId ? pregenReady['distributed-practice'] : undefined}
                />
                <InterventionButton
                  label="Step"
                  icon={<Footprints size={12} />}
                  onClick={() => void handleInterventionClick('stepwise-learning')}
                  disabled={!courseId}
                  ready={sourceDocumentId ? pregenReady['stepwise-learning'] : undefined}
                />
                <InterventionButton
                  label="Elab"
                  icon={<MessageCircleQuestion size={12} />}
                  onClick={() => void handleInterventionClick('interrogative-elaboration')}
                  disabled={!courseId}
                  ready={sourceDocumentId ? pregenReady['interrogative-elaboration'] : undefined}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <div
          className={`px-3 py-1 text-xs text-center ${
            saveStatus === 'saving'
              ? 'bg-blue-50 text-blue-600'
              : saveStatus === 'saved'
                ? 'bg-green-50 text-green-600'
                : 'bg-red-50 text-red-600'
          }`}
        >
          {saveStatus === 'saving' && 'Saving to Review Tab...'}
          {saveStatus === 'saved' && 'Saved to Review Tab!'}
          {saveStatus === 'error' && 'Failed to save. Try again.'}
        </div>
      )}

      {/* Chat input */}
      <div className="px-3 py-2 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={selectedText ? 'Ask about these slides...' : 'Type a message...'}
            disabled={isSending}
            className="flex-1 text-xs border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!inputValue.trim() || isSending}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            <SendHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function PanelHeader({
  onMinimize,
  onToggleMaximize,
  isMaximized,
  onReviewTab,
  isReviewTab,
}: {
  // Optional — the docked variant (StudentCourseViewPage) doesn't provide
  // these because the panel is already part of the page layout, not a
  // floating window. When undefined, the minimize / maximize / close
  // buttons aren't rendered. The header still works as a drag handle for
  // the floating wrapper because that uses the .chatbot-drag-handle class.
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  isMaximized: boolean;
  onReviewTab: () => void;
  isReviewTab: boolean;
}) {
  return (
    <div className="chatbot-drag-handle flex items-center justify-between px-3 py-2 bg-blue-600 text-white cursor-grab active:cursor-grabbing select-none rounded-t-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GraduationCap size={18} />
        <span>Learning Assistant</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReviewTab();
          }}
          className={`w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors ${
            isReviewTab ? 'bg-blue-500' : ''
          }`}
          title="My Reviews"
        >
          <BookMarked size={14} />
        </button>
        {onMinimize && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
        )}
        {onToggleMaximize && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMaximize();
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
        {onMinimize && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function StrategyBackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <span className="text-xs text-gray-400">|</span>
      <span className="text-xs font-medium text-gray-600">{label}</span>
    </div>
  );
}

function InterventionButton({
  label,
  icon,
  onClick,
  disabled,
  ready,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ready?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2.5 py-1 rounded-full transition-colors inline-flex items-center gap-1 ${
        disabled
          ? 'bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
      }`}
    >
      {icon}
      {label}
      {ready === true && <Zap size={9} className="text-green-500 shrink-0" />}
      {ready === false && <Sparkles size={9} className="text-purple-400 shrink-0" />}
    </button>
  );
}
