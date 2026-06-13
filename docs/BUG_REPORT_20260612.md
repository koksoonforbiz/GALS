# Page-aware chat + Elab fixes (2026-06-12)

Six user-reported bugs collapsing into three root causes around the
floating/docked Learning Assistant chat and the Interrogative
Elaboration tutor.

## Bug 1 / 5 / 6 — Main chat is not page-aware

**Symptom.** Student on slide 10 of `Probability-stu.pdf` asks the
floating chat "what is this page about" and gets a generic "agenda for
the probability unit" answer. The Interrogative Elaboration tutor on
the same slide correctly describes the Generative AI diagram. Same
pattern on `LLM.pdf` slide 31 ("Optional Reading") — main chat
answers as if it is slide 30.

**Root cause.**

Two-part regression. The frontend never tells the backend which slide
the student is reading, and the backend would ignore it even if it
did.

- Frontend: `apps/web/src/components/FloatingChatbot/ChatbotPanel.tsx:392-403`.
  The `POST /learning-interventions/chat` body sends `contentId` (the
  module item) but never `pdfCurrentPage`, even though
  `usePageContext()` already exposes it (line 233).
- Backend: `apps/api/src/learning-interventions/learning-interventions.service.ts:3996-4017`.
  When `dto.contentId` is set, `chat()` calls
  `tryResolveFromModuleItem(courseId, contentId)` — which fetches
  ALL DocumentChunks for the PDF (line 1323), joined and capped to
  50 KB. The LLM then sees the whole document with no signal as to
  which slide the student is actually on, and answers from the start
  (slide 1 of `Probability-stu.pdf` is the agenda).
- Compare to `resolveInterventionContext()` at line 740. It accepts a
  `coverage.pages` narrowing and runs `tryResolveFromModuleItemPaged`
  (line 1065), which filters by `pageNumber BETWEEN start AND end`.
  This is what the four intervention generators use; the floating
  chat never opted in.

**Minimal fix.**

- Extend `ChatRequestDto` with optional `currentPage: number`
  (`apps/api/src/learning-interventions/dto/chat.dto.ts`).
- `chat()`: when `contentId` + `currentPage` are both set, narrow to
  `[currentPage - W, currentPage + W]` (W = `RAG_PAGE_WINDOW`,
  default 2) via `tryResolveFromModuleItemPaged`. Defensive: on empty
  result, fall back to the unwindowed `tryResolveFromModuleItem`.
- Frontend `ChatbotPanel.tsx`: include `currentPage: pdfCurrentPage`
  in the POST body.

## Bug 2 — Slide → VLM only works on learning strategies

Same root cause as Bug 1. The VLM-described slide context is wired
into the intervention path only; the chat path never narrowed by
page. Fixing Bug 1 fixes this.

## Bug 3 — Elab session context frozen at first slide

**Symptom.** Student starts Elab on slide 10. Scrolls to slide 12.
Asks "what is this slide about" in the same Elab session. Tutor keeps
describing slide 10.

**Root cause.**

`apps/api/src/learning-interventions/learning-interventions.service.ts:2590-2658`.
`askQuestion()` reads `sessionData.selectedText` (line 2621) — that
field was written ONCE at session creation in `generateSuggestions`
(line 2563) and never refreshed. Every subsequent turn uses the
slide-10 context.

Frontend cooperates with the bug:
`apps/web/src/components/FloatingChatbot/interventions/InterrogativeElaborationView.tsx:232-242`.
The ask payload only sends `question` + `conversationHistory`. Even
if the backend wanted to re-ground, the client never tells it the
current page.

**Minimal fix.**

- Extend `AskQuestionDto` with optional `selectedText`, `contentId`,
  `currentPage`, `courseId`.
- Frontend `InterrogativeElaborationView`: read `pdfCurrentPage` +
  `selectedText` from `usePageContext` on each `handleAskQuestion`
  call (so they are *current*, not the values captured at session
  start) and include them in the POST body.
- Backend `askQuestion()`: when the per-turn payload supplies a fresh
  context, re-resolve via `resolveInterventionContext()` and pass the
  fresh `ctx.text` to `buildElaborationAnswerPrompt` instead of the
  frozen `sessionData.selectedText`. Persist the per-turn
  `selectedText` + `currentPage` into the conversation entry for
  Bug 4.

## Bug 4 — Review only shows the LAST selected text

**Symptom.** Q&A review surface shows the most recent selection only,
not the selection that was active for each individual turn.

**Root cause.**

Two surfaces:

- Chatbot: `chat()` (service.ts:4145) only persists *one*
  `selectedText` per USER row and that is just whatever the student
  most recently sent. The schema is fine
  (`apps/api/prisma/schema.prisma:932`) — the row carries
  `selectedText`. There is NO `currentPage` column. ChatHistory
  detail endpoint already returns `selectedText` per row
  (`apps/api/src/chat-history/chat-history.service.ts:210, 245`).
  The student-facing `ChatHistoryPage.tsx` receives it but never
  renders it.
- Elab: `askQuestion()` (service.ts:2638-2645) appends to
  `sessionData.conversation` with just `{role, content, timestamp}`
  — no `selectedText`, no `currentPage`. The Save-for-Review path
  (`InterrogativeElaborationView.tsx:319`) only stores one
  top-level `selectedText` (the session-start selection).

**Minimal fix.**

- Additive migration
  `20260612000000_add_chatbot_message_selection_context`:
  add `current_page INTEGER NULL` to `chatbot_messages`. (`selected_text`
  already exists.)
- `chat()`: persist `currentPage` on the new USER row.
- Elab `askQuestion()`: each appended `conversation[i]` carries
  `selectedText` and `currentPage` for the moment of the question.
- Student review UI: render per-turn `selectedText` + `currentPage`
  when present.

## Unexpected findings

1. **`tryResolveFromModuleItemPaged` was already wired up** for the
   four intervention generators via `coverage.pages`. The floating
   chat just never opted in — a one-line oversight when chat() was
   added in late 2026-05.
2. The frontend `selectedText` only updates on selections that begin
   inside a `data-selectable="true"` ancestor
   (`PageContext.tsx:138`). PDF text layer in `PdfReader` was already
   marked accordingly (verified — the highlighting flow works).
3. `pdfCurrentPage` is reliably maintained from PdfReader through
   `setPdfCurrentPageText` (`PageContext.tsx:109-112`). All four
   intervention views already read it; only the chat path was
   missing it.
4. The Elab "selectedText" stored in `sessionData.selectedText` is
   *not necessarily the user's highlight* — it is the resolved
   `ctx.text` from `resolveInterventionContext`, which on the
   PDF-source path is the full or page-windowed PDF text. So Bug 3 is
   strictly: "context is resolved once at session start; never
   refreshed".
5. The `chatbot_messages.selectedText` column is being populated
   correctly today (see `chat()` line 4145) — the bug is purely
   render-side.

## Migration

`apps/api/prisma/migrations/20260612000000_add_chatbot_message_selection_context/migration.sql`
— `ALTER TABLE chatbot_messages ADD COLUMN IF NOT EXISTS current_page INTEGER;`
