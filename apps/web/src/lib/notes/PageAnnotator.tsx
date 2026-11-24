import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircleQuestion, NotebookPen, Trash2 } from 'lucide-react';
import type { StudyNote, StudyNoteColor } from '@ats/shared';
import {
  anchorFromRange,
  caretPointFromXY,
  findAnchor,
  indexText,
  rangeFromOffsets,
} from './anchor';
import { NOTE_COLORS } from './colors';
import { useNotes } from './NotesContext';

/**
 * Highlights on the lesson page, and the small toolbar that appears when the
 * student selects text there (Kindle / Hypothesis / Medium pattern):
 * colour dots to highlight, "Note" to highlight and write a note in the
 * Notes tab, "Ask" to ask the assistant about the selection. Clicking an
 * existing highlight brings the same toolbar back to recolour, annotate or
 * remove it.
 *
 * Painting uses the CSS Custom Highlight API, so the lesson's DOM (which
 * React owns, and which the replay recorder snapshots) is never modified.
 * Where the API is missing, notes still work; the page just isn't tinted.
 *
 * Only text inside a `[data-note-scope]` element is annotatable; the scope
 * says which item and slide a highlight belongs to.
 */

const SCOPE = '[data-note-scope]';
const HL_NAMES = {
  yellow: 'gals-hl-yellow',
  green: 'gals-hl-green',
  blue: 'gals-hl-blue',
  pink: 'gals-hl-pink',
  noted: 'gals-hl-noted',
  flash: 'gals-hl-flash',
} as const;

type HighlightCtor = new (...ranges: Range[]) => { add(r: Range): void };
function highlightApi(): { registry: Map<string, unknown>; Ctor: HighlightCtor } | null {
  const g = globalThis as unknown as {
    Highlight?: HighlightCtor;
    CSS?: { highlights?: Map<string, unknown> };
  };
  if (!g.Highlight || !g.CSS?.highlights) return null;
  return { registry: g.CSS.highlights, Ctor: g.Highlight };
}

interface Painted {
  note: StudyNote;
  range: Range;
}

type ToolbarState =
  | { mode: 'new'; x: number; y: number; below: boolean; scope: Element; range: Range }
  | { mode: 'existing'; x: number; y: number; below: boolean; note: StudyNote };

function scopeKey(el: Element) {
  return {
    moduleItemId: el.getAttribute('data-note-item') || null,
    slideKey: el.getAttribute('data-note-slide') || null,
  };
}

function toolbarPos(rect: DOMRect) {
  const above = rect.top > 56;
  return {
    x: Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120),
    y: above ? rect.top - 8 : rect.bottom + 8,
    below: !above,
  };
}

export function PageAnnotator({ container }: { container: HTMLElement | null }) {
  const {
    notes,
    createNote,
    updateNote,
    deleteNote,
    defaultColor,
    setDefaultColor,
    setTab,
    setFocusNoteId,
    askAssistant,
    flashNoteId,
  } = useNotes();
  const painted = useRef<Painted[]>([]);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [tick, setTick] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Re-anchor when the page content changes (slide change, reveal, item change).
  useEffect(() => {
    if (!container) return;
    let t: number | null = null;
    const mo = new MutationObserver(() => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => setTick((n) => n + 1), 120);
    });
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      if (t) window.clearTimeout(t);
    };
  }, [container]);

  // Anchor + paint.
  useLayoutEffect(() => {
    const out: Painted[] = [];
    if (container) {
      for (const scope of container.querySelectorAll(SCOPE)) {
        const { moduleItemId, slideKey } = scopeKey(scope);
        const own = notes.filter(
          (n) => n.quote && n.moduleItemId === moduleItemId && (n.slideKey ?? null) === slideKey,
        );
        if (!own.length) continue;
        const idx = indexText(scope);
        for (const note of own) {
          const at = findAnchor(idx, {
            quote: note.quote!,
            prefix: note.prefix,
            suffix: note.suffix,
          });
          const range = at && rangeFromOffsets(idx, at.start, at.end);
          if (range) out.push({ note, range });
        }
      }
    }
    painted.current = out;
    const hl = highlightApi();
    if (!hl) return;
    const sets: Record<string, Range[]> = {};
    for (const p of out) {
      if (p.note.color) (sets[HL_NAMES[p.note.color]] ??= []).push(p.range);
      if (p.note.body.trim()) (sets[HL_NAMES.noted] ??= []).push(p.range);
      if (p.note.id === flashNoteId) (sets[HL_NAMES.flash] ??= []).push(p.range);
    }
    for (const name of Object.values(HL_NAMES)) {
      const ranges = sets[name];
      if (ranges?.length) hl.registry.set(name, new hl.Ctor(...ranges));
      else hl.registry.delete(name);
    }
  }, [container, notes, tick, flashNoteId]);

  // Clear page highlights when the course page goes away.
  useEffect(
    () => () => {
      const hl = highlightApi();
      if (hl) for (const name of Object.values(HL_NAMES)) hl.registry.delete(name);
    },
    [],
  );

  // After a jump from the Notes tab: bring the highlight into view.
  useEffect(() => {
    if (!flashNoteId) return;
    const p = painted.current.find((x) => x.note.id === flashNoteId);
    const el = p?.range.startContainer.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flashNoteId, tick]);

  const close = useCallback(() => setToolbar(null), []);

  // Selection → toolbar; click on a highlight → toolbar for that note.
  useEffect(() => {
    if (!container) return;
    const onUp = (e: MouseEvent | KeyboardEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      window.setTimeout(() => {
        // Typing or selecting inside the slide's own answer boxes: not page text.
        const active = document.activeElement;
        if (
          active &&
          container.contains(active) &&
          active.matches('textarea, input, select, [contenteditable]')
        ) {
          setToolbar(null);
          return;
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const startEl =
            range.startContainer.nodeType === Node.ELEMENT_NODE
              ? (range.startContainer as Element)
              : range.startContainer.parentElement;
          const scope = startEl?.closest(SCOPE);
          if (!scope || !container.contains(scope) || !scope.contains(range.endContainer)) {
            setToolbar(null);
            return;
          }
          if (sel.toString().trim().length < 2) return;
          setToolbar({
            mode: 'new',
            scope,
            range: range.cloneRange(),
            ...toolbarPos(range.getBoundingClientRect()),
          });
          return;
        }
        if (e instanceof MouseEvent) {
          const pt = caretPointFromXY(e.clientX, e.clientY);
          const hit =
            pt &&
            painted.current.find((p) => {
              try {
                return p.range.isPointInRange(pt.node, pt.offset);
              } catch {
                return false;
              }
            });
          if (hit) {
            const rect = Array.from(hit.range.getClientRects()).find(
              (r) => e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2,
            );
            setToolbar({
              mode: 'existing',
              note: hit.note,
              ...toolbarPos(rect ?? hit.range.getBoundingClientRect()),
            });
            return;
          }
        }
        setToolbar(null);
      }, 0);
    };
    container.addEventListener('mouseup', onUp);
    container.addEventListener('keyup', onUp);
    return () => {
      container.removeEventListener('mouseup', onUp);
      container.removeEventListener('keyup', onUp);
    };
  }, [container]);

  // Dismiss on Escape, scroll, or a click elsewhere.
  useEffect(() => {
    if (!toolbar) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onScroll = (e: Event) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node) && !container?.contains(e.target as Node))
        close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [toolbar, close, container]);

  // Keep the toolbar's note fresh (colour changes while it is open).
  const current =
    toolbar?.mode === 'existing' ? (notes.find((n) => n.id === toolbar.note.id) ?? null) : null;
  useEffect(() => {
    if (toolbar?.mode === 'existing' && !current) setToolbar(null);
  }, [toolbar, current]);

  const highlightSelection = async (color: StudyNoteColor, thenNote: boolean) => {
    if (toolbar?.mode !== 'new') return;
    const anchor = anchorFromRange(toolbar.scope, toolbar.range);
    close();
    window.getSelection()?.removeAllRanges();
    if (!anchor) return;
    setDefaultColor(color);
    const saved = await createNote({
      source: 'highlight',
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      color,
      body: '',
    });
    if (saved && thenNote) {
      setFocusNoteId(saved.id);
      setTab('notes');
    }
  };

  const ask = () => {
    if (!toolbar) return;
    const text =
      toolbar.mode === 'new' ? toolbar.range.toString().trim() : (toolbar.note.quote ?? '');
    close();
    window.getSelection()?.removeAllRanges();
    if (text) askAssistant(text);
  };

  if (!toolbar) return null;
  const activeColor = toolbar.mode === 'existing' ? (current?.color ?? null) : null;
  const btn =
    'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-100 hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={toolbar.mode === 'new' ? 'Highlight or take a note' : 'Edit highlight'}
      data-notes-toolbar=""
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[105] flex items-center gap-0.5 rounded-lg bg-gray-900 px-1.5 py-1 shadow-lg"
      style={{
        left: toolbar.x,
        top: toolbar.y,
        transform: toolbar.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
    >
      {NOTE_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`Highlight ${c.label.toLowerCase()}`}
          aria-label={`Highlight ${c.label.toLowerCase()}`}
          aria-pressed={activeColor === c.id}
          onClick={() =>
            toolbar.mode === 'new'
              ? void highlightSelection(c.id, false)
              : (setDefaultColor(c.id), void updateNote(toolbar.note.id, { color: c.id }))
          }
          className={`mx-0.5 h-5 w-5 rounded-full ${c.swatch} ${
            activeColor === c.id || (toolbar.mode === 'new' && defaultColor === c.id)
              ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900'
              : 'hover:scale-110'
          } transition-transform`}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-gray-600" />
      <button
        type="button"
        className={btn}
        onClick={() => {
          if (toolbar.mode === 'new') void highlightSelection(defaultColor, true);
          else {
            setFocusNoteId(toolbar.note.id);
            setTab('notes');
            close();
          }
        }}
      >
        <NotebookPen size={13} /> Note
      </button>
      <button type="button" className={btn} onClick={ask}>
        <MessageCircleQuestion size={13} /> Ask
      </button>
      {toolbar.mode === 'existing' && (
        <button
          type="button"
          className={btn}
          title="Remove highlight"
          aria-label="Remove highlight"
          onClick={() => {
            const note = current ?? toolbar.note;
            close();
            if (
              note.body.trim() &&
              !window.confirm('Remove this highlight and the note written on it?')
            ) {
              return;
            }
            void deleteNote(note.id);
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>,
    document.body,
  );
}
