# PROMPT 02 — Text Highlighting → Learning Interventions

## Goal

When a student selects (highlights) text in the PDF reader, a small floating popup appears near the selection. The popup lets the student send the highlighted text to the **Learning Interventions** panel in the right studio — pre-filling it with the selected passage so the student can immediately generate a practice question, elaboration, stepwise explanation, or distributed practice card from that excerpt.

---

## Prerequisites

Stage 1 (PROMPT_01) must be complete. `PdfReaderPanel` must be rendering correctly.

---

## 1. Text Selection Detection in `PdfReaderPanel`

`react-pdf` renders each page as a `<canvas>` plus a transparent text layer. The text layer is selectable.

### Hook: `useTextSelection`

**File**: `apps/web/src/hooks/useTextSelection.ts`

```ts
interface TextSelection {
  text: string;
  boundingRect: DOMRect;
}

export function useTextSelection(containerRef: React.RefObject<HTMLElement>): TextSelection | null;
```

**Logic**:

- Listen to `mouseup` on the container element.
- On `mouseup`, call `window.getSelection()`.
- If `selection.toString().trim().length > 10` (ignore tiny accidental selections), compute the bounding rect of the first range via `range.getBoundingClientRect()`.
- Return `{ text, boundingRect }`.
- On `mousedown` anywhere, clear the selection state (reset to `null`).
- Clean up event listeners on unmount.

---

## 2. Floating Selection Popup

**File**: `apps/web/src/components/dialogue/SelectionPopup.tsx`

### Props

```ts
interface SelectionPopupProps {
  selection: { text: string; boundingRect: DOMRect } | null;
  onSendToIntervention: (text: string, strategy: InterventionStrategy) => void;
  onSaveToNotes: (text: string) => void; // wired up in Stage 3 — accept prop now, no-op until then
  onDismiss: () => void;
}

type InterventionStrategy =
  | 'practice_testing'
  | 'elaboration'
  | 'stepwise'
  | 'distributed_practice';
```

### Visual Layout

The popup appears **above** the selection bounding rect, horizontally centred.

```
┌─────────────────────────────────────────────────────┐
│  [Lightbulb] Practice Test  [MessageSquare] Explain │
│  [List] Step-by-step        [Calendar] Spaced Rep   │
│  ─────────────────────────────────────────────────  │
│  [Bookmark] Save to Notes                           │
└─────────────────────────────────────────────────────┘
```

**Positioning**: use `position: fixed` using `boundingRect.top`, `boundingRect.left + boundingRect.width/2` from the selection, offset upward by the popup height + 8px. Use `transform: translateX(-50%)` to centre horizontally. Ensure it stays within viewport using `Math.max`/`Math.min` clamping.

### Icons (all `lucide-react`)

- `Lightbulb` — Practice Test
- `MessageSquare` — Explain (Elaboration)
- `List` — Step-by-step (Stepwise)
- `CalendarDays` — Spaced Rep (Distributed Practice)
- `Bookmark` — Save to Notes

### Styling

- `bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl`
- `z-50 p-2 flex flex-col gap-1 min-w-[200px]`
- Each button: `flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-gray-700 dark:text-gray-200 w-full text-left transition-colors`
- Divider between strategies and "Save to Notes": `border-t border-gray-100 dark:border-gray-700 my-1`
- "Save to Notes" button: uses `text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30`
- Dismiss on `Escape` key or clicking outside.

---

## 3. Wire Popup into `PdfReaderPanel`

In `PdfReaderPanel`:

1. Add a `ref` to the scrollable PDF container div.
2. Call `useTextSelection(containerRef)` to get `selection`.
3. Render `<SelectionPopup>` when `selection !== null`.
4. Pass `onSendToIntervention` and `onSaveToNotes` (no-op for now) callbacks.
5. Pass `onDismiss` that clears the selection state.

### New prop on `PdfReaderPanel`

```ts
interface PdfReaderPanelProps {
  // ... existing props from Stage 1
  onSendToIntervention: (text: string, strategy: InterventionStrategy) => void;
  onSaveHighlightToNotes: (text: string) => void; // wired in Stage 3
}
```

---

## 4. Intervention Strategy Routing

The `onSendToIntervention` callback lives in `DialogueLearning` and bridges the PDF reader → right studio panel.

### In `DialogueLearning`

```ts
const handleSendToIntervention = (text: string, strategy: InterventionStrategy) => {
  // 1. Switch the right studio panel to the "Learn" / interventions tab
  setActiveStudioTab('learn'); // use whatever state controls the right panel tab
  // 2. Pre-fill the intervention context
  setInterventionPrefill({ text, strategy });
};
```

### New state

```ts
interface InterventionPrefill {
  text: string;
  strategy: InterventionStrategy;
  triggeredAt: number; // Date.now() — used as a key to re-trigger even if same text
}
const [interventionPrefill, setInterventionPrefill] = useState<InterventionPrefill | null>(null);
```

Pass `interventionPrefill` as a prop to the existing `LearningInterventions` (or equivalent) component in the right studio panel.

---

## 5. Pre-fill Behaviour in the Interventions Component

**File**: locate the component in `apps/web/src/components/dialogue/` that renders the "Learn" tab / learning interventions UI.

### Changes

Accept a new optional prop:

```ts
interventionPrefill?: { text: string; strategy: InterventionStrategy; triggeredAt: number } | null;
```

When `interventionPrefill` changes (use `useEffect` with `[interventionPrefill?.triggeredAt]` as dependency):

1. Set the active strategy tab to `interventionPrefill.strategy`.
2. Pre-fill the context/prompt input field with the highlighted text, wrapped in a clear label:

```
[Highlighted from PDF]
"<the selected text>"
```

3. Scroll the strategy input into view (`scrollIntoView({ behavior: 'smooth' })`).
4. Optionally auto-trigger the generation if the text is under 500 characters (add a `useEffect` guard with a 300ms delay to feel intentional).

---

## 6. Backend — No New Endpoints Required

The highlighted text is passed into the **existing** intervention generation endpoint. The frontend already calls something like:

```
POST /learning-interventions/generate
{ type, context, sessionId, courseId }
```

The only change is the `context` field now contains the highlighted PDF text. No backend changes needed.

---

## 7. Visual Feedback

After clicking a strategy button in the popup:

- Show a brief toast/snackbar: `"Sending to [Strategy Name]..."` (use whatever toast system exists in the app, or add `react-hot-toast` if absent).
- Dismiss the popup immediately.
- The right panel animates/scrolls to show the pre-filled intervention form.

---

## 8. Acceptance Criteria

- [ ] Selecting text in the PDF (>10 chars) shows the floating `SelectionPopup`
- [ ] Popup is correctly positioned above the selection
- [ ] Popup disappears on Escape, outside click, or after action
- [ ] Clicking a strategy button switches right panel to "Learn" tab
- [ ] Highlighted text appears pre-filled in the correct strategy input
- [ ] Auto-generation triggers for short excerpts (<500 chars)
- [ ] "Save to Notes" button is visible (may be no-op until Stage 3)
- [ ] All icons from `lucide-react` — no emoji
- [ ] No TypeScript errors
- [ ] Existing chat-mode intervention flow is unaffected
