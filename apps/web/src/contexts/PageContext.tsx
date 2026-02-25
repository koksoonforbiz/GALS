import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type PageType = 'lesson' | 'quiz' | 'reading' | 'dashboard' | 'review-tab' | 'other';

interface PageContextType {
  pageType: PageType;
  courseId: string | null;
  contentId: string | null;
  contentTitle: string | null;
  contentText: string | null;
  selectedText: string | null;
  setPageContext: (
    ctx: Partial<Pick<PageContextType, 'pageType' | 'courseId' | 'contentId' | 'contentTitle' | 'contentText'>>,
  ) => void;
  setSelectedText: (text: string | null) => void;
  clearSelectedText: () => void;
}

const PageContext = createContext<PageContextType | null>(null);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [pageType, setPageType] = useState<PageType>('other');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [contentTitle, setContentTitle] = useState<string | null>(null);
  const [contentText, setContentText] = useState<string | null>(null);
  const [selectedText, setSelectedTextState] = useState<string | null>(null);

  const setPageContext = useCallback(
    (
      ctx: Partial<Pick<PageContextType, 'pageType' | 'courseId' | 'contentId' | 'contentTitle' | 'contentText'>>,
    ) => {
      if (ctx.pageType !== undefined) setPageType(ctx.pageType);
      if (ctx.courseId !== undefined) setCourseId(ctx.courseId);
      if (ctx.contentId !== undefined) setContentId(ctx.contentId);
      if (ctx.contentTitle !== undefined) setContentTitle(ctx.contentTitle);
      if (ctx.contentText !== undefined) setContentText(ctx.contentText);
    },
    [],
  );

  const setSelectedText = useCallback((text: string | null) => {
    setSelectedTextState(text);
  }, []);

  const clearSelectedText = useCallback(() => {
    setSelectedTextState(null);
  }, []);

  // Global text selection listener
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && text.length >= 20) {
        setSelectedTextState(text);
      }
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
        setPageContext,
        setSelectedText,
        clearSelectedText,
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
