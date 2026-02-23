import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// ─── Types ─────────────────────────────────────────────────

export type PageType = 'lesson' | 'quiz' | 'reading' | 'dashboard' | 'review-queue' | 'assessments' | 'other';

interface PageContextState {
  // Current page info
  pageType: PageType;
  courseId: string | null;
  contentId: string | null; // lesson ID, quiz ID, attempt ID, etc.
  contentTitle: string | null; // "Lesson 3: Introduction to Power BI"

  // Selected text from the current page
  selectedText: string | null;
}

interface PageContextType extends PageContextState {
  // Methods
  setPageContext: (ctx: Partial<Omit<PageContextState, 'selectedText'>>) => void;
  setSelectedText: (text: string | null) => void;
  clearSelectedText: () => void;
  clearPageContext: () => void;
}

// ─── Default State ─────────────────────────────────────────

const defaultState: PageContextState = {
  pageType: 'other',
  courseId: null,
  contentId: null,
  contentTitle: null,
  selectedText: null,
};

// ─── Context ───────────────────────────────────────────────

const PageContext = createContext<PageContextType | undefined>(undefined);

// ─── Provider ──────────────────────────────────────────────

interface PageContextProviderProps {
  children: ReactNode;
}

export function PageContextProvider({ children }: PageContextProviderProps) {
  const [state, setState] = useState<PageContextState>(defaultState);

  // Set page context (without selected text)
  const setPageContext = useCallback((ctx: Partial<Omit<PageContextState, 'selectedText'>>) => {
    setState((prev) => ({
      ...prev,
      ...ctx,
    }));
  }, []);

  // Set selected text
  const setSelectedText = useCallback((text: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedText: text,
    }));
  }, []);

  // Clear selected text
  const clearSelectedText = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedText: null,
    }));
  }, []);

  // Clear entire page context (useful when navigating away)
  const clearPageContext = useCallback(() => {
    setState(defaultState);
  }, []);

  // ─── Global Text Selection Listener ────────────────────────
  // Listen for text selection anywhere on the page
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      // Only capture if text is at least 20 characters
      if (text && text.length >= 20) {
        setSelectedText(text);
      }
    };

    // Also handle keyboard selection (Shift+Arrow, Ctrl+Shift+End, etc.)
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey) {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (text && text.length >= 20) {
          setSelectedText(text);
        }
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [setSelectedText]);

  const value: PageContextType = {
    ...state,
    setPageContext,
    setSelectedText,
    clearSelectedText,
    clearPageContext,
  };

  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

// ─── Hook ──────────────────────────────────────────────────

export function usePageContext(): PageContextType {
  const context = useContext(PageContext);
  if (!context) {
    throw new Error('usePageContext must be used within a PageContextProvider');
  }
  return context;
}

// ─── Helper Hook for Setting Page Context on Mount ─────────

interface UseSetPageContextOptions {
  pageType: PageType;
  courseId?: string | null;
  contentId?: string | null;
  contentTitle?: string | null;
}

export function useSetPageContext(options: UseSetPageContextOptions, deps: unknown[] = []) {
  const { setPageContext, clearPageContext } = usePageContext();

  useEffect(() => {
    setPageContext({
      pageType: options.pageType,
      courseId: options.courseId ?? null,
      contentId: options.contentId ?? null,
      contentTitle: options.contentTitle ?? null,
    });

    // Clear context when unmounting
    return () => {
      clearPageContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
