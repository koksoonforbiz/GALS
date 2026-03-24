# Master Build Instructions — ATS Reading & Note-Taking Interface

## Overview

You are building a **PDF Reading & Note-Taking Interface** inside the existing **Dialogue Learning** page of the Adaptive Tutoring System (ATS).

This feature spans **3 stages**. You must complete them in order. Each stage has its own prompt file:

| Stage | File                                   | Description                                                    |
| ----- | -------------------------------------- | -------------------------------------------------------------- |
| 1     | `PROMPT_01_PDF_READER_PANEL.md`        | PDF reader replaces chat panel when student opens a document   |
| 2     | `PROMPT_02_HIGHLIGHT_INTERVENTIONS.md` | Text highlighting on PDF triggers learning intervention panel  |
| 3     | `PROMPT_03_NOTE_TAKING_TAB.md`         | Note-taking tab: save highlights, write comments, manage notes |

---

## How to Execute

Read and implement each prompt file **one at a time**, in order:

```
1. Read PROMPT_01_PDF_READER_PANEL.md — implement fully — confirm done
2. Read PROMPT_02_HIGHLIGHT_INTERVENTIONS.md — implement fully — confirm done
3. Read PROMPT_03_NOTE_TAKING_TAB.md — implement fully — confirm done
```

---

## Critical Global Rules (apply to ALL stages)

1. **No emoji anywhere** — use only icons from `lucide-react`. Import them explicitly (e.g. `import { BookOpen, Highlighter } from 'lucide-react'`).
2. **PDF only** — the read-document feature is restricted to `.pdf` files. Non-PDF documents show a tooltip/badge saying "PDF only".
3. **Existing right panel must remain fully functional** — Learn, Guide, Flashcards, Mindmap, FAQ, and all studio tabs must still work when the PDF reader is open.
4. **Do not break any existing Dialogue Learning functionality** — the 3-panel layout (sources | chat | studio) must still be the default view.
5. **TypeScript strict mode** — all new code must be fully typed. No `any` unless unavoidable.
6. **Tailwind CSS only** — no inline styles, no new CSS files unless absolutely necessary.
7. **Respect the monorepo structure**:
   - Frontend: `apps/web/src/pages/student/` and `apps/web/src/components/dialogue/`
   - Backend: `apps/api/src/` (new NestJS modules/endpoints where needed)
   - Shared types: `packages/shared/src/`
8. **New backend endpoints** must follow existing NestJS patterns — use Prisma, DTOs, guards, and existing auth middleware.
9. **All new database models** must be added to `apps/api/prisma/schema.prisma` with a corresponding migration.
10. **WebSocket** updates (if needed) go into the existing `/dialogue` namespace gateway.

---

## Architecture Reference Summary

- **Dialogue page route**: `/student/courses/:courseId/dialogue`
- **Component**: `DialogueLearning` in `apps/web/src/pages/student/`
- **Existing layout**: 3 panels — left (sources/documents), center (chat), right (studio tabs)
- **Document upload**: handled by `StudentRAG` module — files stored in MinIO, metadata in `StudentSourceDocument`
- **LLM**: `apps/api/src/rag/llm.service.ts`
- **Interventions**: `apps/api/src/learning-interventions/`
- **WebSocket**: `/dialogue` namespace with `join_session`, `message_chunk`, `message_complete`, `processing_update`
- **Shared Zod schemas**: `packages/shared/src/`

---

## When All Stages Are Complete

Run a final check:

- [ ] PDF reader opens and renders correctly
- [ ] Switching back to chat view works
- [ ] Text highlight popup appears on selection
- [ ] Highlight → Intervention flow works end-to-end
- [ ] Note-taking tab saves, edits, and deletes notes
- [ ] All lucide-react icons render (no raw emoji)
- [ ] No TypeScript errors
- [ ] No existing tests broken
