# PROMPT 03 — Note-Taking Tab (Right Studio Panel)

## Goal

Add a **"Notes"** tab to the right studio panel. Students can:

- Save highlighted PDF text as notes with optional personal commentary
- Write free-form notes not tied to any PDF highlight
- View, edit, search, and delete all notes for the current dialogue session
- See persistent highlight markers on the PDF for saved excerpts
- Export all notes as a plain-text or markdown summary

All notes are **persisted to the database** and scoped to a `DialogueSession`.

---

## Prerequisites

Stages 1 and 2 (PROMPT_01 and PROMPT_02) must be complete.

---

## 1. Database Schema

Add to `apps/api/prisma/schema.prisma`:

```prisma
model DialogueNote {
  id            String   @id @default(cuid())
  sessionId     String
  studentId     String
  courseId      String

  // Source — null means free-form note
  sourceDocumentId  String?
  pageNumber        Int?
  highlightedText   String?   // the raw PDF excerpt

  // Student content
  noteText      String    // student's own commentary (can be empty string)
  color         String    @default("yellow")  // yellow | green | blue | pink | purple

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  session       DialogueSession        @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  student       User                   @relation(fields: [studentId], references: [id])
  sourceDocument StudentSourceDocument? @relation(fields: [sourceDocumentId], references: [id])

  @@index([sessionId])
  @@index([studentId])
}
```

Add the inverse relation `DialogueNote[]` to `DialogueSession` and `User` models accordingly.

Run:

```bash
pnpm --filter api prisma migrate dev --name add_dialogue_notes
pnpm --filter api prisma generate
```

---

## 2. Backend — Notes Module

**New NestJS module**: `apps/api/src/dialogue-notes/`

### Files to create

```
dialogue-notes/
  dialogue-notes.module.ts
  dialogue-notes.controller.ts
  dialogue-notes.service.ts
  dto/
    create-note.dto.ts
    update-note.dto.ts
```

### Endpoints

```
POST   /dialogue-notes              Create a note (highlight or free-form)
GET    /dialogue-notes?sessionId=   List all notes for a session
PATCH  /dialogue-notes/:id          Update noteText or color
DELETE /dialogue-notes/:id          Delete a note
GET    /dialogue-notes/export/:sessionId   Export as markdown (plain text response)
```

### DTOs (add to `packages/shared/src/dialogue-notes.schema.ts`)

```ts
export const CreateNoteSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  sourceDocumentId: z.string().optional(),
  pageNumber: z.number().int().optional(),
  highlightedText: z.string().optional(),
  noteText: z.string(),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).default('yellow'),
});

export const UpdateNoteSchema = z.object({
  noteText: z.string().optional(),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).optional(),
});

export const DialogueNoteSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sourceDocumentId: z.string().nullable(),
  pageNumber: z.number().nullable(),
  highlightedText: z.string().nullable(),
  noteText: z.string(),
  color: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

### Service rules

- All operations verify the `studentId` from JWT matches the note's `studentId` (ownership check).
- `GET export` returns a formatted markdown string — no JSON:

```markdown
# Notes — [Session Date] — [Course Name]

## Note 1 — Page 4 — [Document Name]

> "The highlighted text excerpt here"

Student comment: My personal note goes here.

---

## Note 2 — Free-form

My note text here.

---
```

---

## 3. Frontend — Notes Tab

### 3a. Add tab to studio panel

In the right studio panel tab list, add a new tab after the last existing tab:

```tsx
<Tab icon={<NotebookPen size={16} />} label="Notes" value="notes" />
```

Icon: `NotebookPen` from `lucide-react`.

### 3b. New Component: `NotesPanel`

**File**: `apps/web/src/components/dialogue/NotesPanel.tsx`

```ts
interface NotesPanelProps {
  sessionId: string;
  courseId: string;
  // Injected when a highlight arrives from the PDF reader
  pendingHighlight?: {
    text: string;
    sourceDocumentId: string;
    documentName: string;
    pageNumber?: number;
  } | null;
  onPendingHighlightConsumed: () => void;
}
```

---

## 4. Notes Panel Layout

```
┌────────────────────────────────────────┐
│  TOOLBAR                               │
│  [Search input............] [Download] │
├────────────────────────────────────────┤
│  [+ New Note] button (full width)      │
├────────────────────────────────────────┤
│  NOTES LIST (scrollable)               │
│  ┌──────────────────────────────────┐  │
│  │ COLOR BAR │ Source badge (PDF p4) │  │
│  │ Highlighted: "...excerpt..."     │  │
│  │ ─────────────────────────────── │  │
│  │ Student comment text here        │  │
│  │ [Edit] [Send to Learn] [Trash2]  │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ COLOR BAR │ Free-form note       │  │
│  │ Note text here...                │  │
│  │ [Edit] [Trash2]                  │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### Icons (all `lucide-react`)

- `Search` — search input
- `Download` — export notes
- `Plus` — New Note button
- `Pencil` — Edit
- `Trash2` — Delete
- `Lightbulb` — Send to Learn (intervention)
- `FileText` — PDF source badge
- `StickyNote` — free-form note badge
- `X` — cancel edit / close inline editor
- `Check` — save edit
- `ChevronDown` / `ChevronUp` — collapse/expand long notes

---

## 5. Note Card Design

Each note is a card:

- Left border color: `border-l-4` where color maps to:
  - `yellow` → `border-yellow-400`
  - `green` → `border-green-400`
  - `blue` → `border-blue-400`
  - `pink` → `border-pink-400`
  - `purple` → `border-purple-400`
- Card: `bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 mb-3`
- Source badge (when from PDF): `inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-gray-600 dark:text-gray-300`
- Highlighted text block: `bg-gray-50 dark:bg-gray-700/50 border-l-2 border-gray-300 dark:border-gray-500 pl-3 py-1 text-sm italic text-gray-600 dark:text-gray-300 my-2 line-clamp-3`
- Long highlights (>200 chars): show collapsed by default with a "Show more" / `ChevronDown` toggle
- Student note text: `text-sm text-gray-800 dark:text-gray-200`
- Timestamp: `text-xs text-gray-400 dark:text-gray-500 mt-2`

### Color picker inside note card / editor

Show 5 small colored circle buttons to change the note's color:

```tsx
{
  ['yellow', 'green', 'blue', 'pink', 'purple'].map((c) => (
    <button
      key={c}
      className={`w-4 h-4 rounded-full border-2 ${activeColor === c ? 'border-gray-800 dark:border-white scale-110' : 'border-transparent'}`}
      style={{ backgroundColor: colorMap[c] }}
      onClick={() => handleColorChange(c)}
    />
  ));
}
```

---

## 6. Inline Note Editor

When "New Note" is clicked OR "Edit" on an existing note:

- An inline form replaces / expands below the card (no modal):

```
┌──────────────────────────────────────┐
│  [Textarea: "Write your note..."]    │
│  Color: ● ● ● ● ●                   │
│  [Check Save]  [X Cancel]            │
└──────────────────────────────────────┘
```

- `Textarea`: `min-h-[80px]`, auto-grow, `resize-none`
- On save: call `POST /dialogue-notes` or `PATCH /dialogue-notes/:id`
- On cancel: discard changes, collapse editor
- Empty noteText is allowed only when there is a `highlightedText` (highlight-only note)

---

## 7. Highlight → Save to Notes Flow (complete Stage 2 integration)

### In `DialogueLearning`

Wire up the `onSaveHighlightToNotes` callback from `PdfReaderPanel` (stubbed in Stage 2):

```ts
const handleSaveHighlightToNotes = (
  text: string,
  sourceDocumentId: string,
  documentName: string,
  pageNumber?: number,
) => {
  setActiveStudioTab('notes'); // switch right panel to Notes tab
  setPendingHighlight({ text, sourceDocumentId, documentName, pageNumber });
};
```

### In `NotesPanel`

When `pendingHighlight` prop changes (non-null):

1. Open the inline note editor pre-filled with:
   - `highlightedText` = `pendingHighlight.text`
   - `sourceDocumentId` = `pendingHighlight.sourceDocumentId`
   - `pageNumber` = `pendingHighlight.pageNumber`
   - `noteText` = `""` (empty, ready for student to type)
2. Focus the textarea.
3. Call `onPendingHighlightConsumed()` to reset parent state.

The student can then type their comment and save, or just save the highlight with no comment.

---

## 8. "Send to Learn" from Note Card

Each note card with `highlightedText` shows a `Lightbulb` button — "Send to Learn". On click:

- Calls the same `onSendToIntervention(text, 'elaboration')` callback from Stage 2.
- Switches right panel to the "Learn" tab with the note's highlighted text pre-filled.

---

## 9. Search

- Search input filters notes client-side (no API call needed).
- Match against `highlightedText` + `noteText` — case-insensitive.
- Matching text is highlighted in the card using `<mark>` tags styled with `bg-yellow-200 dark:bg-yellow-800 rounded px-0.5`.
- Show "No notes match your search" empty state with `SearchX` icon when nothing matches.

---

## 10. Export

`GET /dialogue-notes/export/:sessionId` returns a markdown file.

Frontend download:

```ts
const blob = new Blob([markdownText], { type: 'text/markdown' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `notes-${sessionId}.md`;
a.click();
URL.revokeObjectURL(url);
```

Show a `Download` icon button in the toolbar. Disable + show `Loader2` spinner while request is in flight.

---

## 11. Empty State

When there are no notes:

```
[NotebookPen icon — large, muted]
No notes yet
Highlight text in the PDF or click "+ New Note" to get started.
```

---

## 12. PDF Highlight Persistence Markers (optional enhancement)

If time permits, after saving a note from a highlight, draw a persistent yellow underline on the corresponding text in the PDF:

- Store the highlight range metadata (start/end character offset or DOM range serialization) in the note as a JSON field `highlightRange`.
- On PDF load, re-apply highlight overlays using the text layer's character positions.
- This is **optional** — mark clearly in code with `// TODO: highlight persistence` if deferring.

---

## 13. API Integration (Frontend)

**File**: `apps/web/src/lib/api.ts` (add to existing api helper)

```ts
export const notesApi = {
  list: (sessionId: string) => api.get(`/dialogue-notes?sessionId=${sessionId}`),
  create: (data: CreateNoteDto) => api.post('/dialogue-notes', data),
  update: (id: string, data: UpdateNoteDto) => api.patch(`/dialogue-notes/${id}`, data),
  delete: (id: string) => api.delete(`/dialogue-notes/${id}`),
  export: (sessionId: string) =>
    api.get(`/dialogue-notes/export/${sessionId}`, { responseType: 'text' }),
};
```

Use `react-query` (or whatever data-fetching library is already in the project) for caching and optimistic updates on create/delete.

---

## 14. Acceptance Criteria

- [ ] "Notes" tab appears in the right studio panel with `NotebookPen` icon
- [ ] Free-form notes can be created, edited, and deleted
- [ ] Highlighted PDF text can be saved to notes (from `SelectionPopup` "Save to Notes" button)
- [ ] Saved highlight notes show the excerpt, source document name, and page number
- [ ] Inline editor opens pre-filled when a highlight arrives
- [ ] Color picker works — card border updates immediately
- [ ] Search filters notes in real-time
- [ ] Matched search text is highlighted in cards
- [ ] Export downloads a `.md` file with all notes
- [ ] "Send to Learn" from a note card pre-fills the interventions tab
- [ ] Empty state renders when no notes exist
- [ ] Notes persist across page refreshes (stored in DB)
- [ ] All icons from `lucide-react` — no emoji
- [ ] No TypeScript errors
- [ ] Ownership check on backend — students can only access their own notes
