import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { StudyNote, StudyNoteColor } from '@ats/shared';
import { NOTE_COLORS, noteBarClass } from './colors';
import { useNotes } from './NotesContext';

/**
 * The Notes view of the right-hand panel (alternates with the Learning
 * Assistant in the same column). Patterns taken from:
 *  - NotebookLM / Edge Copilot: chat and notes as two views of one side panel;
 *    assistant answers can be saved into notes.
 *  - Coursera / edX notes: notes listed by where they were taken, with a link
 *    back to that place in the lesson.
 *  - Kindle notebook: highlights grouped by location, filterable by colour.
 */

type Scope = 'slide' | 'session' | 'all';

function slideOrder(location: string): number {
  // Location labels end in "· 12. Slide heading" for interactive lessons.
  const m = /·\s*(\d+)\.\s/.exec(location);
  return m ? Number(m[1]) : 0;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotesPanel({ itemOrder }: { itemOrder: Record<string, number> }) {
  const { notes, loaded, error, location, createNote, focusNoteId, setFocusNoteId } = useNotes();
  const [scope, setScope] = useState<Scope>('slide');
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<StudyNoteColor | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // A note opened from the page (toolbar "Note") must be visible.
  useEffect(() => {
    if (!focusNoteId) return;
    const n = notes.find((x) => x.id === focusNoteId);
    if (!n) return;
    const onSlide =
      n.moduleItemId === (location?.moduleItemId ?? null) &&
      (n.slideKey ?? null) === (location?.slideKey ?? null);
    if (!onSlide && scope === 'slide') setScope('session');
    setQuery('');
    setColor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNoteId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (scope === 'slide') {
        if (n.moduleItemId !== (location?.moduleItemId ?? null)) return false;
        if ((n.slideKey ?? null) !== (location?.slideKey ?? null)) return false;
      } else if (scope === 'session') {
        if (n.moduleItemId !== (location?.moduleItemId ?? null)) return false;
      }
      if (color && n.color !== color) return false;
      if (q && !`${n.quote ?? ''} ${n.body} ${n.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notes, scope, location, color, query]);

  const groups = useMemo(() => {
    const byLoc = new Map<string, StudyNote[]>();
    for (const n of filtered) {
      const k = `${n.moduleItemId ?? ''}|${n.slideKey ?? ''}|${n.location}`;
      byLoc.set(k, [...(byLoc.get(k) ?? []), n]);
    }
    return [...byLoc.values()].sort((a, b) => {
      const ia = itemOrder[a[0]!.moduleItemId ?? ''] ?? 1e6;
      const ib = itemOrder[b[0]!.moduleItemId ?? ''] ?? 1e6;
      if (ia !== ib) return ia - ib;
      return slideOrder(a[0]!.location) - slideOrder(b[0]!.location);
    });
  }, [filtered, itemOrder]);

  const saveDraft = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    const saved = await createNote({ source: 'note', body: draft.trim(), color: null });
    setSaving(false);
    if (saved) setDraft('');
  };

  const copyAll = async () => {
    const lines: string[] = [];
    for (const g of groups) {
      lines.push(`## ${g[0]!.location || 'Notes'}`);
      for (const n of g) {
        if (n.quote) lines.push(`> ${n.quote.replace(/\n+/g, ' ')}`);
        if (n.body.trim()) lines.push(n.body.trim());
        lines.push('');
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n').trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: nothing to do
    }
  };

  const scopeBtn = (s: Scope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(s)}
      aria-pressed={scope === s}
      className={`flex-1 rounded px-2 py-0.5 text-[11px] font-medium ${
        scope === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-replay-region="notes">
      {/* Filters */}
      <div className="space-y-1.5 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <div
          className="flex rounded-md bg-gray-200/70 p-0.5"
          role="group"
          aria-label="Show notes from"
        >
          {scopeBtn('slide', 'This slide')}
          {scopeBtn('session', 'This lesson')}
          {scopeBtn('all', 'All')}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="relative flex-1">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="w-full rounded-md border border-gray-300 bg-white py-1 pl-6 pr-2 text-xs focus:border-blue-400 focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Filter by colour">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={`Only ${c.label.toLowerCase()}`}
                aria-label={`Only ${c.label.toLowerCase()} highlights`}
                aria-pressed={color === c.id}
                onClick={() => setColor(color === c.id ? null : c.id)}
                className={`h-3.5 w-3.5 rounded-full ${c.swatch} ${
                  color === c.id ? 'ring-2 ring-gray-700 ring-offset-1' : color ? 'opacity-40' : ''
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
        {!loaded ? (
          <p className="py-6 text-center text-xs text-gray-400">Loading your notes…</p>
        ) : groups.length === 0 ? (
          <EmptyState filtered={notes.length > 0} scope={scope} />
        ) : (
          groups.map((g) => (
            <section key={`${g[0]!.moduleItemId}|${g[0]!.slideKey}|${g[0]!.location}`}>
              {scope !== 'slide' && (
                <h4
                  className="mb-1 truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                  title={g[0]!.location}
                >
                  {g[0]!.location || 'Course notes'}
                </h4>
              )}
              <ul className="space-y-2">
                {g.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    focused={focusNoteId === n.id}
                    onFocused={() => setFocusNoteId(null)}
                    showJump={
                      n.moduleItemId !== (location?.moduleItemId ?? null) ||
                      (n.slideKey ?? null) !== (location?.slideKey ?? null) ||
                      !!n.quote
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* Quick note on the current slide */}
      <div className="border-t border-gray-200 px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void saveDraft();
            }
          }}
          rows={2}
          maxLength={5000}
          aria-label="Write a note about this slide"
          placeholder={location ? 'Write a note about this slide…' : 'Write a note…'}
          className="w-full resize-none rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={!draft.trim() || saving}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
          <span className="text-[10px] text-gray-400">Ctrl+Enter to save</span>
          {notes.length > 0 && (
            <button
              type="button"
              onClick={() => void copyAll()}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
              title="Copy the notes shown above"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ filtered, scope }: { filtered: boolean; scope: Scope }) {
  if (filtered) {
    return (
      <p className="py-6 text-center text-xs text-gray-400">
        {scope === 'slide' ? 'No notes on this slide yet.' : 'No notes match.'}
      </p>
    );
  }
  return (
    <div className="px-2 py-6 text-center text-xs text-gray-500">
      <p className="font-medium text-gray-700">Your notes for this course</p>
      <p className="mt-2">
        Select any text on a slide to{' '}
        <span className="rounded bg-yellow-200 px-0.5">highlight</span> it or add a note to it.
      </p>
      <p className="mt-1">You can also write a note below, or save an assistant answer here.</p>
    </div>
  );
}

function NoteCard({
  note,
  focused,
  onFocused,
  showJump,
}: {
  note: StudyNote;
  focused: boolean;
  onFocused: () => void;
  showJump: boolean;
}) {
  const { updateNote, deleteNote, jumpTo, askAssistant } = useNotes();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setBody(note.body);
  }, [note.body, editing]);

  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setEditing(true);
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    if (body === note.body) return;
    if (!body.trim() && !note.quote) {
      setBody(note.body);
      return;
    }
    await updateNote(note.id, { body });
  };

  const long = (note.quote?.length ?? 0) > 280;
  const action =
    'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800';

  return (
    <li ref={ref} className="group rounded-md border border-gray-200 bg-white p-2 shadow-sm">
      {note.quote && (
        <blockquote
          className={`border-l-4 ${noteBarClass(note.color)} ${
            note.source === 'assistant' ? 'border-l-violet-300 bg-violet-50/50' : ''
          } pl-2 text-xs italic text-gray-700`}
        >
          {note.source === 'assistant' && (
            <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium not-italic text-violet-600">
              <Sparkles size={10} /> Saved from the assistant
            </span>
          )}
          <span
            className={`whitespace-pre-wrap break-words ${long && !expanded ? 'line-clamp-4' : ''}`}
          >
            {note.quote}
          </span>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 block text-[10px] not-italic text-blue-600 hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </blockquote>
      )}

      {editing ? (
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              setBody(note.body);
              setEditing(false);
            }
          }}
          rows={3}
          maxLength={5000}
          aria-label="Your note"
          placeholder="Write your note in your own words…"
          className="mt-1.5 w-full resize-y rounded border border-blue-300 px-2 py-1 text-xs focus:outline-none"
        />
      ) : note.body.trim() ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1.5 block w-full whitespace-pre-wrap break-words rounded px-0.5 text-left text-xs text-gray-800 hover:bg-gray-50"
          title="Edit note"
        >
          {note.body}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 text-[11px] text-blue-600 hover:underline"
        >
          + Add a note
        </button>
      )}

      <div className="mt-1.5 flex items-center gap-0.5">
        <span className="mr-auto text-[10px] text-gray-400">{timeAgo(note.createdAt)}</span>
        {confirmDelete ? (
          <>
            <span className="text-[11px] text-gray-600">Delete?</span>
            <button
              type="button"
              className={`${action} text-red-600`}
              onClick={() => void deleteNote(note.id)}
            >
              Yes
            </button>
            <button type="button" className={action} onClick={() => setConfirmDelete(false)}>
              No
            </button>
          </>
        ) : (
          <>
            {showJump && note.moduleItemId && (
              <button
                type="button"
                className={action}
                onClick={() => jumpTo(note)}
                title="Go to this slide"
              >
                <ArrowUpRight size={12} /> Go to
              </button>
            )}
            <button
              type="button"
              className={action}
              onClick={() => askAssistant([note.quote, note.body].filter(Boolean).join('\n\n'))}
              title="Ask the assistant about this"
            >
              <MessageCircleQuestion size={12} /> Ask
            </button>
            <button
              type="button"
              className={action}
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              aria-label="Delete note"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
