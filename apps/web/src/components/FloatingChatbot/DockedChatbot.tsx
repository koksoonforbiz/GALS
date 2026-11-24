import { GraduationCap, NotebookPen } from 'lucide-react';
import { ChatbotPanel } from './ChatbotPanel';
import { NotesPanel } from '../../lib/notes/NotesPanel';
import { useNotesOptional, type NotesTab } from '../../lib/notes/NotesContext';

/**
 * Right-side docked variant of the chatbot, rendering `ChatbotPanel`
 * inside a fixed flex column within a page (as opposed to a floating
 * draggable window).
 *
 * On the course page (inside a NotesProvider) the same column alternates
 * between the Learning Assistant and the student's Notes, switched from the
 * panel header. The assistant stays mounted while Notes is shown, so a
 * conversation or a strategy in progress is not lost.
 */
interface DockedChatbotProps {
  onClearAllHighlights?: () => void;
  /** Called just before a learning strategy launches; resolves VLM descriptions for image slides. */
  resolveVlmSlides?: () => Promise<string | null>;
  /** module item id → course order, for grouping notes */
  itemOrder?: Record<string, number>;
}

export function DockedChatbot({
  onClearAllHighlights,
  resolveVlmSlides,
  itemOrder = {},
}: DockedChatbotProps) {
  const notes = useNotesOptional();
  const tab: NotesTab = notes?.tab ?? 'assistant';
  const tabs = notes ? (
    <PanelTabs tab={tab} onTab={notes.setTab} count={notes.notes.length} />
  ) : undefined;

  return (
    <div className="flex flex-col h-full w-full bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      {/* No onMinimize / onToggleMaximize — the optional buttons in
          PanelHeader hide themselves when those props are omitted. */}
      <div className={tab === 'assistant' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ChatbotPanel
          onClearAllHighlights={onClearAllHighlights}
          resolveVlmSlides={resolveVlmSlides}
          headerTitle={tabs}
        />
      </div>
      {notes && tab === 'notes' && (
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="flex items-center px-3 py-2 bg-blue-600 text-white select-none rounded-t-lg">
            {tabs}
          </div>
          <NotesPanel itemOrder={itemOrder} />
        </div>
      )}
    </div>
  );
}

function PanelTabs({
  tab,
  onTab,
  count,
}: {
  tab: NotesTab;
  onTab: (t: NotesTab) => void;
  count: number;
}) {
  const cls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? 'bg-white text-blue-700 shadow-sm' : 'text-blue-50 hover:bg-blue-500'
    }`;
  return (
    <div
      role="tablist"
      aria-label="Side panel"
      className="flex items-center gap-1"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'assistant'}
        onClick={() => onTab('assistant')}
        className={cls(tab === 'assistant')}
      >
        <GraduationCap size={15} /> Assistant
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'notes'}
        onClick={() => onTab('notes')}
        className={cls(tab === 'notes')}
        data-testid="notes-tab"
      >
        <NotebookPen size={14} /> Notes
        {count > 0 && (
          <span
            className={`rounded-full px-1.5 text-[10px] leading-4 ${
              tab === 'notes' ? 'bg-blue-100 text-blue-700' : 'bg-blue-500 text-white'
            }`}
          >
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
