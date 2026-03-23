import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Download,
  Plus,
  Pencil,
  Trash2,
  Lightbulb,
  FileText,
  StickyNote,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  NotebookPen,
  SearchX,
  Loader2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../Toast';

interface DialogueNote {
  id: string;
  sessionId: string;
  sourceDocumentId: string | null;
  pageNumber: number | null;
  highlightedText: string | null;
  noteText: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  sourceDocument?: { originalName: string } | null;
}

interface PendingHighlight {
  text: string;
  sourceDocumentId: string;
  documentName: string;
  pageNumber?: number;
}

interface NotesPanelProps {
  sessionId: string;
  courseId: string;
  pendingHighlight?: PendingHighlight | null;
  onPendingHighlightConsumed: () => void;
  onSendToIntervention?: (text: string) => void;
}

const COLOR_MAP: Record<string, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
  purple: '#a78bfa',
};

const BORDER_COLORS: Record<string, string> = {
  yellow: 'border-yellow-400',
  green: 'border-green-400',
  blue: 'border-blue-400',
  pink: 'border-pink-400',
  purple: 'border-purple-400',
};

export function NotesPanel({
  sessionId,
  courseId,
  pendingHighlight,
  onPendingHighlightConsumed,
  onSendToIntervention,
}: NotesPanelProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<DialogueNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editColor, setEditColor] = useState('yellow');
  const [isCreating, setIsCreating] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteColor, setNewNoteColor] = useState('yellow');
  const [newHighlight, setNewHighlight] = useState<PendingHighlight | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      const data = await api.get<DialogueNote[]>(`/dialogue-notes?sessionId=${sessionId}`);
      setNotes(data);
    } catch {
      toast('error', 'Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, toast]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Handle pending highlight from PDF
  useEffect(() => {
    if (!pendingHighlight) return;
    setIsCreating(true);
    setNewHighlight(pendingHighlight);
    setNewNoteText('');
    setNewNoteColor('yellow');
    onPendingHighlightConsumed();
    // Focus textarea after render
    setTimeout(() => newNoteRef.current?.focus(), 100);
  }, [pendingHighlight, onPendingHighlightConsumed]);

  // Create note
  const handleCreate = async () => {
    try {
      const note = await api.post<DialogueNote>('/dialogue-notes', {
        sessionId,
        courseId,
        sourceDocumentId: newHighlight?.sourceDocumentId,
        pageNumber: newHighlight?.pageNumber,
        highlightedText: newHighlight?.text,
        noteText: newNoteText,
        color: newNoteColor,
      });
      setNotes((prev) => [note, ...prev]);
      setIsCreating(false);
      setNewNoteText('');
      setNewHighlight(null);
      toast('success', 'Note saved');
    } catch {
      toast('error', 'Failed to save note');
    }
  };

  // Update note
  const handleUpdate = async (id: string) => {
    try {
      const updated = await api.patch<DialogueNote>(`/dialogue-notes/${id}`, {
        noteText: editText,
        color: editColor,
      });
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      setEditingId(null);
      toast('success', 'Note updated');
    } catch {
      toast('error', 'Failed to update note');
    }
  };

  // Delete note
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/dialogue-notes/${id}`);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast('success', 'Note deleted');
    } catch {
      toast('error', 'Failed to delete note');
    }
  };

  // Export notes
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/dialogue-notes/export/${sessionId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-${sessionId}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('error', 'Failed to export notes');
    } finally {
      setIsExporting(false);
    }
  };

  // Toggle expand/collapse for long highlights
  const toggleExpand = (id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Filter notes by search
  const filteredNotes = searchQuery
    ? notes.filter(
        (n) =>
          (n.highlightedText || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.noteText.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : notes;

  // Highlight search matches in text
  const highlightMatch = (text: string) => {
    if (!searchQuery) return text;
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-3 border-b border-gray-200 flex items-center gap-2">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleExport}
          disabled={notes.length === 0 || isExporting}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 disabled:opacity-50 transition-colors"
          title="Export notes as markdown"
        >
          {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        </button>
      </div>

      {/* New note button */}
      <div className="px-3 pt-3">
        {!isCreating && (
          <button
            onClick={() => {
              setIsCreating(true);
              setNewHighlight(null);
              setNewNoteText('');
              setNewNoteColor('yellow');
              setTimeout(() => newNoteRef.current?.focus(), 100);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <Plus size={14} />
            New Note
          </button>
        )}

        {/* Inline new note editor */}
        {isCreating && (
          <div
            className={`border-l-4 ${BORDER_COLORS[newNoteColor] || 'border-yellow-400'} bg-white border border-gray-200 rounded-lg p-3 mb-3`}
          >
            {newHighlight && (
              <div className="bg-gray-50 border-l-2 border-gray-300 pl-3 py-1 text-sm italic text-gray-600 mb-2 line-clamp-3">
                &quot;{newHighlight.text}&quot;
                <div className="text-xs text-gray-400 mt-1 not-italic">
                  <FileText size={10} className="inline mr-1" />
                  {newHighlight.documentName}
                  {newHighlight.pageNumber && ` - p.${newHighlight.pageNumber}`}
                </div>
              </div>
            )}
            <textarea
              ref={newNoteRef}
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              placeholder="Write your note..."
              className="w-full min-h-[80px] text-sm border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                {(['yellow', 'green', 'blue', 'pink', 'purple'] as const).map((c) => (
                  <button
                    key={c}
                    className={`w-4 h-4 rounded-full border-2 ${newNoteColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: COLOR_MAP[c] }}
                    onClick={() => setNewNoteColor(c)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCreate}
                  disabled={!newNoteText.trim() && !newHighlight}
                  className="p-1.5 rounded-md text-green-600 hover:bg-green-50 disabled:opacity-50 transition-colors"
                  title="Save"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewHighlight(null);
                    setNewNoteText('');
                  }}
                  className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
                  title="Cancel"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {filteredNotes.length === 0 && !isCreating && notes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <NotebookPen size={32} className="text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 font-medium">No notes yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Highlight text in the PDF or click &quot;+ New Note&quot; to get started.
            </p>
          </div>
        )}

        {filteredNotes.length === 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <SearchX size={24} className="text-gray-300 mb-2" />
            <p className="text-xs text-gray-400">No notes match your search</p>
          </div>
        )}

        <div className="space-y-3 mt-3">
          {filteredNotes.map((note) => {
            const isEditing = editingId === note.id;
            const isLongHighlight = (note.highlightedText?.length ?? 0) > 200;
            const isExpanded = expandedNotes.has(note.id);

            return (
              <div
                key={note.id}
                className={`border-l-4 ${BORDER_COLORS[note.color] || 'border-yellow-400'} bg-white rounded-lg border border-gray-200 p-3`}
              >
                {/* Source badge */}
                {note.sourceDocumentId && note.sourceDocument && (
                  <span className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600 mb-2">
                    <FileText size={10} />
                    {note.sourceDocument.originalName}
                    {note.pageNumber && ` p.${note.pageNumber}`}
                  </span>
                )}
                {!note.sourceDocumentId && (
                  <span className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600 mb-2">
                    <StickyNote size={10} />
                    Free-form note
                  </span>
                )}

                {/* Highlighted text */}
                {note.highlightedText && (
                  <div className="bg-gray-50 border-l-2 border-gray-300 pl-3 py-1 text-sm italic text-gray-600 my-2">
                    <div className={!isExpanded && isLongHighlight ? 'line-clamp-3' : ''}>
                      {highlightMatch(note.highlightedText)}
                    </div>
                    {isLongHighlight && (
                      <button
                        onClick={() => toggleExpand(note.id)}
                        className="flex items-center gap-1 text-xs text-blue-500 mt-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp size={12} /> Show less
                          </>
                        ) : (
                          <>
                            <ChevronDown size={12} /> Show more
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Note text or editor */}
                {isEditing ? (
                  <div className="mt-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full min-h-[60px] text-sm border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        {(['yellow', 'green', 'blue', 'pink', 'purple'] as const).map((c) => (
                          <button
                            key={c}
                            className={`w-4 h-4 rounded-full border-2 ${editColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: COLOR_MAP[c] }}
                            onClick={() => setEditColor(c)}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleUpdate(note.id)}
                          className="p-1 rounded text-green-600 hover:bg-green-50 transition-colors"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded text-gray-400 hover:bg-gray-100 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {note.noteText && (
                      <p className="text-sm text-gray-800 mt-1">{highlightMatch(note.noteText)}</p>
                    )}
                  </>
                )}

                {/* Timestamp and actions */}
                {!isEditing && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">
                      {new Date(note.createdAt).toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingId(note.id);
                          setEditText(note.noteText);
                          setEditColor(note.color);
                        }}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      {note.highlightedText && onSendToIntervention && (
                        <button
                          onClick={() => onSendToIntervention(note.highlightedText!)}
                          className="p-1 rounded text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          title="Send to Learn"
                        >
                          <Lightbulb size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
