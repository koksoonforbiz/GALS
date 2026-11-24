import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CreateStudyNote, StudyNote, StudyNoteColor } from '@ats/shared';
import { api, ApiError } from '../api';
import { useActivityLog } from '../activity-log';
import { usePageContext } from '../../contexts/PageContext';

/**
 * Study notes for one course page: the student's highlights and notes, the
 * place they are reading now (for new notes and the "This slide" filter),
 * and which view the right-hand panel shows (Assistant or Notes). One panel,
 * two views: the Notes tab replaces the chat in place, it never adds a column.
 *
 * Activity log (Process Mining Library v1 #14/#15, rule M04): ids, lengths,
 * colour and the slide anchor only. The note text itself stays in the
 * student's own notes table and never goes into the event log.
 */

export type NotesTab = 'assistant' | 'notes';

export interface NotesLocation {
  moduleItemId: string | null;
  slideKey: string | null;
  /** shown on the note: "Session 1 · 4. Why prompts fail" */
  label: string;
}

export type NewNote = Omit<CreateStudyNote, 'courseId' | 'moduleItemId' | 'slideKey' | 'location'>;

interface NotesContextValue {
  courseId: string;
  notes: StudyNote[];
  loaded: boolean;
  error: string | null;
  location: NotesLocation | null;
  setLocation: (l: NotesLocation | null) => void;
  tab: NotesTab;
  setTab: (t: NotesTab) => void;
  /** note to scroll to / open for editing in the Notes view */
  focusNoteId: string | null;
  setFocusNoteId: (id: string | null) => void;
  /** highlight to flash on the page after a jump */
  flashNoteId: string | null;
  defaultColor: StudyNoteColor;
  setDefaultColor: (c: StudyNoteColor) => void;
  createNote: (n: NewNote) => Promise<StudyNote | null>;
  updateNote: (
    id: string,
    patch: { body?: string; color?: StudyNoteColor | null },
  ) => Promise<boolean>;
  deleteNote: (id: string) => Promise<boolean>;
  /** open the note's slide (and flash its highlight) */
  jumpTo: (note: StudyNote) => void;
  registerNavigator: (fn: ((note: StudyNote) => void) | null) => void;
  /** put text in the assistant's question context and switch to it */
  askAssistant: (text: string) => void;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export const FOCUS_ASSISTANT_EVENT = 'gals:focus-assistant';
const COLOR_KEY = 'gals.notes.color';

function loadColor(): StudyNoteColor {
  try {
    const c = localStorage.getItem(COLOR_KEY);
    if (c === 'yellow' || c === 'green' || c === 'blue' || c === 'pink') return c;
  } catch {
    // storage unavailable: default colour
  }
  return 'yellow';
}

export function NotesProvider({ courseId, children }: { courseId: string; children: ReactNode }) {
  const { track } = useActivityLog();
  const { setSelectedText } = usePageContext();
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<NotesLocation | null>(null);
  const [tab, setTabState] = useState<NotesTab>('assistant');
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [flashNoteId, setFlashNoteId] = useState<string | null>(null);
  const [defaultColor, setDefaultColorState] = useState<StudyNoteColor>(loadColor);
  const navigator = useRef<((note: StudyNote) => void) | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    let current = true;
    setLoaded(false);
    api
      .get<StudyNote[]>(`/study-notes?courseId=${courseId}`)
      .then((rows) => {
        if (!current) return;
        setNotes(rows);
        setError(null);
      })
      .catch(() => current && setError('Your notes could not be loaded. Please reload the page.'))
      .finally(() => current && setLoaded(true));
    return () => {
      current = false;
    };
  }, [courseId]);

  const log = useCallback(
    (action: Parameters<typeof track>[0], n: StudyNote, extra: Record<string, unknown> = {}) =>
      track(action, {
        courseId,
        moduleItemId: n.moduleItemId ?? undefined,
        metadata: {
          libraryVersion: 'v2',
          noteId: n.id,
          slideKey: n.slideKey,
          source: n.source,
          color: n.color,
          quoteChars: n.quote?.length ?? 0,
          ...extra,
        },
      }),
    [track, courseId],
  );

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const setTab = useCallback(
    (t: NotesTab) => {
      if (t === 'notes' && tabRef.current !== 'notes') {
        track('NOTES_VIEWED', {
          courseId,
          metadata: { libraryVersion: 'v2', noteCount: notesRef.current.length },
        });
      }
      tabRef.current = t;
      setTabState(t);
    },
    [track, courseId],
  );

  const setDefaultColor = useCallback((c: StudyNoteColor) => {
    setDefaultColorState(c);
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      // only a convenience
    }
  }, []);

  const createNote = useCallback(
    async (n: NewNote): Promise<StudyNote | null> => {
      try {
        const saved = await api.post<StudyNote>('/study-notes', {
          ...n,
          courseId,
          moduleItemId: location?.moduleItemId ?? null,
          slideKey: location?.slideKey ?? null,
          location: location?.label ?? '',
        });
        setNotes((prev) => [...prev, saved]);
        if (saved.quote && saved.source === 'highlight') log('HIGHLIGHT_CREATED', saved);
        if (saved.body.trim() || saved.source === 'assistant') {
          log('NOTE_CREATED', saved, { chars: saved.body.trim().length, anchored: !!saved.quote });
        }
        setError(null);
        return saved;
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'That note was not saved. Please try again.',
        );
        return null;
      }
    },
    [courseId, location, log],
  );

  const updateNote = useCallback(
    async (id: string, patch: { body?: string; color?: StudyNoteColor | null }) => {
      const before = notesRef.current.find((x) => x.id === id);
      if (!before) return false;
      setNotes((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        const saved = await api.patch<StudyNote>(`/study-notes/${id}`, patch);
        setNotes((prev) => prev.map((x) => (x.id === id ? saved : x)));
        if (patch.body !== undefined && patch.body !== before.body) {
          const chars = patch.body.trim().length;
          if (!before.body.trim() && chars) {
            log('NOTE_CREATED', saved, { chars, anchored: !!saved.quote });
          } else {
            log('NOTE_EDITED', saved, { chars, prevChars: before.body.trim().length });
          }
        }
        setError(null);
        return true;
      } catch (err) {
        setNotes((prev) => prev.map((x) => (x.id === id ? before : x)));
        setError(
          err instanceof ApiError ? err.message : 'That change was not saved. Please try again.',
        );
        return false;
      }
    },
    [log],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const before = notesRef.current.find((x) => x.id === id);
      if (!before) return false;
      setNotes((prev) => prev.filter((x) => x.id !== id));
      try {
        await api.delete(`/study-notes/${id}`);
        log(
          before.quote && before.source === 'highlight' ? 'HIGHLIGHT_DELETED' : 'NOTE_DELETED',
          before,
          {
            hadNote: !!before.body.trim(),
          },
        );
        return true;
      } catch {
        setNotes((prev) =>
          [...prev, before].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        );
        setError('That note was not deleted. Please try again.');
        return false;
      }
    },
    [log],
  );

  const jumpTo = useCallback((note: StudyNote) => {
    navigator.current?.(note);
    if (note.quote) {
      setFlashNoteId(note.id);
      window.setTimeout(() => setFlashNoteId((cur) => (cur === note.id ? null : cur)), 2200);
    }
  }, []);

  const registerNavigator = useCallback((fn: ((note: StudyNote) => void) | null) => {
    navigator.current = fn;
  }, []);

  const askAssistant = useCallback(
    (text: string) => {
      setSelectedText(text);
      setTabState('assistant');
      window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSISTANT_EVENT)), 0);
    },
    [setSelectedText],
  );

  const value = useMemo<NotesContextValue>(
    () => ({
      courseId,
      notes,
      loaded,
      error,
      location,
      setLocation,
      tab,
      setTab,
      focusNoteId,
      setFocusNoteId,
      flashNoteId,
      defaultColor,
      setDefaultColor,
      createNote,
      updateNote,
      deleteNote,
      jumpTo,
      registerNavigator,
      askAssistant,
    }),
    [
      courseId,
      notes,
      loaded,
      error,
      location,
      tab,
      setTab,
      focusNoteId,
      flashNoteId,
      defaultColor,
      setDefaultColor,
      createNote,
      updateNote,
      deleteNote,
      jumpTo,
      registerNavigator,
      askAssistant,
    ],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesContextValue {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within a NotesProvider');
  return ctx;
}

/** Null outside a course page (the floating assistant elsewhere has no notes). */
export function useNotesOptional(): NotesContextValue | null {
  return useContext(NotesContext);
}
