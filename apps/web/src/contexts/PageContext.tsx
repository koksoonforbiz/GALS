import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { CodeContext } from '../lib/pyodideRunner';

export type PageType = 'lesson' | 'quiz' | 'reading' | 'dashboard' | 'review-tab' | 'other';

export interface ActiveCodeQuestion {
  question: string;
  starterCode: string;
  language: string;
}

interface PageContextType {
  pageType: PageType;
  courseId: string | null;
  contentId: string | null;
  contentTitle: string | null;
  contentText: string | null;
  selectedText: string | null;
  /**
   * Id of the teacher-uploaded source document the student is currently
   * reading (typically a PDF inside a PDF-type module item). Used by the
   * floating chatbot to tell the backend which source to ground on when
   * the student has not highlighted anything.
   */
  sourceDocumentId: string | null;
  /**
   * P3 — total page count of the currently-rendered PDF, when one is
   * open. The student-facing PracticeTestingView reads this to default
   * the page-range upper bound (and enforce an upper `max` on the
   * input) so the student doesn't pick pp.40-50 on a 20-page PDF. Null
   * when no PDF is open, or while the PDF is still loading.
   */
  pdfNumPages: number | null;
  pdfCurrentPage: number | null;
  pdfCurrentPageText: string | null;
  /**
   * True when a page (e.g. StudentCourseViewPage) renders the chatbot
   * inline as a docked right-side panel. The global FloatingChatbot reads
   * this and hides itself so we never show both at once. Pages opt in by
   * calling setChatbotDocked(true) on mount and setChatbotDocked(false)
   * on unmount.
   */
  chatbotDocked: boolean;
  /**
   * The student's most recent Python run — from the inline code-question
   * widget in chat OR the standalone Playground, whichever ran last.
   * Attached to the next chat message so the assistant can see the real
   * code/output/error instead of guessing. Cleared whenever a new code
   * question is generated.
   */
  codeContext: CodeContext | null;
  /**
   * The most recently generated coding exercise, set the moment it's
   * generated — independent of `codeContext` above, which only exists
   * after the student clicks Run. Lets the backend answer "what's the
   * answer" / "give me a hint" before any run happened. Overwritten
   * whenever a new exercise is generated.
   */
  activeCodeQuestion: ActiveCodeQuestion | null;
  setPageContext: (
    ctx: Partial<
      Pick<
        PageContextType,
        'pageType' | 'courseId' | 'contentId' | 'contentTitle' | 'contentText' | 'sourceDocumentId'
      >
    >,
  ) => void;
  setSelectedText: (text: string | null) => void;
  clearSelectedText: () => void;
  setChatbotDocked: (docked: boolean) => void;
  setCodeContext: (ctx: CodeContext | null) => void;
  setActiveCodeQuestion: (q: ActiveCodeQuestion | null) => void;
  /** Set by the PdfReader (via the lifting prop `onPdfMeta`) so
   *  intervention views can default page-range inputs sensibly. */
  setPdfNumPages: (n: number | null) => void;
  setPdfCurrentPageText: (page: number | null, text: string | null) => void;
}

const PageContext = createContext<PageContextType | null>(null);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [pageType, setPageType] = useState<PageType>('other');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [contentTitle, setContentTitle] = useState<string | null>(null);
  const [contentText, setContentText] = useState<string | null>(null);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [selectedText, setSelectedTextState] = useState<string | null>(null);
  const [chatbotDocked, setChatbotDockedState] = useState<boolean>(false);
  const [codeContext, setCodeContextState] = useState<CodeContext | null>(null);
  const [activeCodeQuestion, setActiveCodeQuestionState] = useState<ActiveCodeQuestion | null>(
    null,
  );
  const [pdfNumPages, setPdfNumPagesState] = useState<number | null>(null);
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number | null>(null);
  const [pdfCurrentPageText, setPdfCurrentPageTextState] = useState<string | null>(null);

  const setPageContext = useCallback(
    (
      ctx: Partial<
        Pick<
          PageContextType,
          | 'pageType'
          | 'courseId'
          | 'contentId'
          | 'contentTitle'
          | 'contentText'
          | 'sourceDocumentId'
        >
      >,
    ) => {
      if (ctx.pageType !== undefined) setPageType(ctx.pageType);
      if (ctx.courseId !== undefined) setCourseId(ctx.courseId);
      if (ctx.contentId !== undefined) setContentId(ctx.contentId);
      if (ctx.contentTitle !== undefined) setContentTitle(ctx.contentTitle);
      if (ctx.contentText !== undefined) setContentText(ctx.contentText);
      if (ctx.sourceDocumentId !== undefined) setSourceDocumentId(ctx.sourceDocumentId);
    },
    [],
  );

  const setSelectedText = useCallback((text: string | null) => {
    setSelectedTextState(text);
  }, []);

  const clearSelectedText = useCallback(() => {
    setSelectedTextState(null);
  }, []);

  const setChatbotDocked = useCallback((docked: boolean) => {
    setChatbotDockedState(docked);
  }, []);

  const setCodeContext = useCallback((ctx: CodeContext | null) => {
    setCodeContextState(ctx);
  }, []);

  const setActiveCodeQuestion = useCallback((q: ActiveCodeQuestion | null) => {
    setActiveCodeQuestionState(q);
  }, []);

  const setPdfNumPages = useCallback((n: number | null) => {
    setPdfNumPagesState(n);
  }, []);

  const setPdfCurrentPageText = useCallback((page: number | null, text: string | null) => {
    setPdfCurrentPage(page);
    setPdfCurrentPageTextState(text);
  }, []);

  // Global text selection listener. Scoped: only captures selections that
  // BEGIN inside an element marked `data-selectable="true"` (or a
  // descendant of one). This stops accidental selections in the navbar,
  // sidebar, header, or other UI chrome from leaking into the chatbot as
  // if they were lesson highlights — previously you could end up with
  // "username Sign out Session recording…" arriving as `selectedText`
  // and confusing the LLM.
  //
  // Pages that want their content to feed the chatbot should put
  // `data-selectable="true"` on the lesson-content container (e.g.
  // StudentCourseViewPage marks the right-hand content panel).
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 20) return;

      const anchor = selection?.anchorNode;
      if (!anchor) return;
      // Selection origin's Element. Text nodes have parentElement; element
      // nodes are themselves Elements.
      const startEl: Element | null =
        anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
      if (!startEl) return;
      if (!startEl.closest('[data-selectable="true"]')) return;

      setSelectedTextState(text);
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <PageContext.Provider
      value={{
        pageType,
        courseId,
        contentId,
        contentTitle,
        contentText,
        selectedText,
        sourceDocumentId,
        pdfNumPages,
        pdfCurrentPage,
        pdfCurrentPageText,
        chatbotDocked,
        codeContext,
        activeCodeQuestion,
        setPageContext,
        setSelectedText,
        clearSelectedText,
        setChatbotDocked,
        setCodeContext,
        setActiveCodeQuestion,
        setPdfNumPages,
        setPdfCurrentPageText,
      }}
    >
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext(): PageContextType {
  const context = useContext(PageContext);
  if (!context) {
    throw new Error('usePageContext must be used within a PageContextProvider');
  }
  return context;
}
