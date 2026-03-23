# PROMPT 01 — PDF Reader Panel (replaces Chat Panel)

## Goal
When a student clicks a PDF document in the left sources panel of the Dialogue Learning page, the **center chat panel is replaced** by a full PDF reader. The right studio panel stays untouched and fully functional. A clear UI affordance lets the student switch back to the chat view at any time.

---

## 1. Install Required Package

Add `react-pdf` to the web app:

```bash
pnpm --filter web add react-pdf
pnpm --filter web add -D @types/react-pdf
```

Configure the PDF.js worker inside `apps/web/src/main.tsx` (or a dedicated setup file):

```ts
import { pdfjs } from 'react-pdf';
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
```

---

## 2. New Component: `PdfReaderPanel`

**File**: `apps/web/src/components/dialogue/PdfReaderPanel.tsx`

### Props interface

```ts
interface PdfReaderPanelProps {
  documentId: string;        // StudentSourceDocument.id
  documentName: string;      // display name
  documentUrl: string;       // presigned MinIO URL
  onClose: () => void;       // callback to return to chat view
}
```

### Layout inside `PdfReaderPanel`

```
┌──────────────────────────────────────────────────────┐
│  TOOLBAR (sticky top)                                 │
│  [ArrowLeft] Back to Chat   [filename]   [ZoomIn][ZoomOut][RotateCw]  [Page X / Y]  │
├──────────────────────────────────────────────────────┤
│                                                       │
│   react-pdf <Document> + <Page> rendered here        │
│   Scrollable, full height                            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Toolbar icons (all from `lucide-react`)
- `ArrowLeft` — back to chat
- `ZoomIn` / `ZoomOut` — scale PDF (min 0.5, max 2.5, step 0.25)
- `RotateCw` — rotate 90°
- `ChevronLeft` / `ChevronRight` — previous/next page
- `FileText` — shown next to document name

### Behaviour
- Default zoom: `1.0` (100%)
- All pages are rendered in a scrollable column (not paginated, continuous scroll). Page number in the toolbar updates on scroll.
- Show a `Loader2` (spinning) icon while the PDF loads.
- On load error, show an inline error state with `AlertCircle` icon: *"Could not load PDF. Please try again."*
- The component must **NOT** render anything related to the studio/right panel — it only owns the center column.

---

## 3. Presigned URL Endpoint (Backend)

The frontend needs a temporary URL to stream the PDF from MinIO.

**Module**: `apps/api/src/blob/blob.controller.ts` (add to existing Blob module)

### New endpoint

```
GET /blob/presign/:documentId
Authorization: Bearer <token>  (student role)
```

**Logic**:
1. Look up `StudentSourceDocument` by `id`, verify it belongs to the authenticated student.
2. Call MinIO `presignedGetObject` with a 15-minute expiry.
3. Return `{ url: string }`.

**DTO** (`packages/shared/src/blob.schema.ts`):
```ts
export const PresignedUrlResponseSchema = z.object({
  url: z.string().url(),
});
export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;
```

---

## 4. Source Document List — "Read" Button

**File**: Locate the component that renders the left panel source/document list inside `DialogueLearning`. It is likely in `apps/web/src/components/dialogue/` — find the component that maps over `StudentSourceDocument` records.

### Changes

For each document in the list:
- If `mimeType === 'application/pdf'` (or filename ends with `.pdf`): show a `BookOpen` icon button labelled **"Read"** next to the document name.
- If the document is NOT a PDF: show a `BookOpen` icon button with a `title` tooltip: *"Reading is available for PDF files only"* and the button must be **disabled** (`opacity-50 cursor-not-allowed`).

### On "Read" click (PDF only)
1. Call `GET /blob/presign/:documentId` to get the presigned URL.
2. Set view mode to `'pdf-reader'` with `{ documentId, documentName, documentUrl }` stored in local state.

---

## 5. View Mode State in `DialogueLearning`

In `DialogueLearning`, manage a view mode state for the **center panel**:

```ts
type CenterPanelMode =
  | { type: 'chat' }
  | { type: 'pdf-reader'; documentId: string; documentName: string; documentUrl: string };

const [centerPanel, setCenterPanel] = useState<CenterPanelMode>({ type: 'chat' });
```

### Render logic (center column only)

```tsx
{centerPanel.type === 'chat' ? (
  <ChatPanel ... />  // existing chat component — unchanged
) : (
  <PdfReaderPanel
    documentId={centerPanel.documentId}
    documentName={centerPanel.documentName}
    documentUrl={centerPanel.documentUrl}
    onClose={() => setCenterPanel({ type: 'chat' })}
  />
)}
```

The left sources panel and the right studio panel are **not wrapped in this conditional** — they always render.

---

## 6. Visual Design

- Toolbar background: `bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700`
- Toolbar height: `h-12`
- PDF canvas area: `bg-gray-100 dark:bg-gray-800 overflow-y-auto flex-1`
- Center each rendered page with a white drop-shadow card: `bg-white shadow-md mx-auto my-4 rounded`
- Page gap: `gap-4`
- Toolbar buttons: `rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors`
- Active/current page indicator: `text-sm text-gray-600 dark:text-gray-300 font-mono`

---

## 7. Acceptance Criteria

- [ ] Clicking "Read" on a PDF document replaces the chat panel with `PdfReaderPanel`
- [ ] Non-PDF documents show a disabled "Read" button with tooltip
- [ ] Clicking `ArrowLeft` / "Back to Chat" restores the chat panel with previous state intact
- [ ] PDF renders all pages in a scrollable continuous view
- [ ] Zoom in/out and rotate work correctly
- [ ] Page counter updates as user scrolls
- [ ] Right studio panel (Learn, Guide, etc.) remains fully usable while PDF is open
- [ ] Loading and error states are handled
- [ ] No emoji — all icons from `lucide-react`
- [ ] No TypeScript errors
