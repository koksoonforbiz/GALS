import { ChatbotPanel } from './ChatbotPanel';

/**
 * Right-side docked variant of the chatbot, rendering `ChatbotPanel`
 * inside a fixed flex column within a page (as opposed to a floating
 * draggable window).
 */
interface DockedChatbotProps {
  onClearAllHighlights?: () => void;
  /** Called just before a learning strategy launches; resolves VLM descriptions for image slides. */
  resolveVlmSlides?: () => Promise<string | null>;
}

export function DockedChatbot({ onClearAllHighlights, resolveVlmSlides }: DockedChatbotProps) {
  return (
    <div className="flex flex-col h-full w-full bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      {/* No onMinimize / onToggleMaximize — the optional buttons in
          PanelHeader hide themselves when those props are omitted. */}
      <ChatbotPanel
        onClearAllHighlights={onClearAllHighlights}
        resolveVlmSlides={resolveVlmSlides}
      />
    </div>
  );
}
