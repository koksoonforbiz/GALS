import { useEffect } from 'react';
import { ChatbotPanel } from './ChatbotPanel';
import { usePageContext } from '../../contexts/PageContext';

/**
 * Right-side docked variant of the chatbot. Wraps the same `ChatbotPanel`
 * the floating version uses, so logging (track + flush), session storage
 * persistence, intervention strategies, selection handling, and PDF /
 * RAG grounding all behave identically — the only difference is the
 * container is a fixed flex column inside a page, not a draggable
 * window.
 *
 * Pages that mount this component MUST also call setChatbotDocked(true)
 * on mount / false on unmount via PageContext, so the global
 * FloatingChatbot hides itself while the docked variant is on screen.
 * This component does that bookkeeping automatically.
 */
export function DockedChatbot({ onClearAllHighlights }: { onClearAllHighlights?: () => void }) {
  const { setChatbotDocked } = usePageContext();

  // Flip the suppress-floating-chatbot flag while this component is
  // mounted, so the user sees exactly one chatbot UI.
  useEffect(() => {
    setChatbotDocked(true);
    return () => setChatbotDocked(false);
  }, [setChatbotDocked]);

  return (
    <div className="flex flex-col h-full w-full bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      {/* No onMinimize / onToggleMaximize — the optional buttons in
          PanelHeader hide themselves when those props are omitted. */}
      <ChatbotPanel onClearAllHighlights={onClearAllHighlights} />
    </div>
  );
}
