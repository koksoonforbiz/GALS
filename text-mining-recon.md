# Text-Mining EF Detection — Codebase Reconnaissance

## 1. Hook point for ingesting student utterances

**File**: `apps/api/src/dialogue/dialogue.service.ts`
**Function**: `sendMessage(sessionId, studentId, dto, activitySessionId?)`
**Line**: ~196-202 — USER message created via `prisma.dialogueMessage.create({ data: { sessionId, role: 'USER', content: dto.content } })`

The fire-and-forget detection call should be injected after the user message is persisted (after the transaction at ~line 203+). Access to: `dto.content` (utterance), `sessionId`, `studentId`, `course.teacherId`, `course.id`.

## 2. Existing RAG retriever to reuse

**File**: `apps/api/src/dialogue/dialogue.service.ts`
**Function**: `retrieveStudentChunks(studentId, courseId, sourceIds, query, topK)`
**Returns**: `Array<{ id, documentId, documentName, pageNumber, content, score }>`

Also available: `apps/api/src/student-rag/student-rag-retrieval.service.ts` → `retrieve(query, studentId, courseId, activeSourceIds, topK, apiKey, provider)` with embedding-based dense+sparse retrieval.

For engagement context, call the simpler `retrieveStudentChunks` with `topK=2`.

## 3. AI settings storage location

**Table**: `users` (Prisma model `User`)
**Columns**: `llmProvider` (string), `encryptedApiKey` (string, AES-256-GCM), `llmModel` (string)
**Encryption**: `aes-256-gcm` with key derived from `JWT_SECRET` via `crypto.scryptSync(secret, 'llm-key-salt', 32)`
**Service**: `LlmService` in `apps/api/src/rag/llm.service.ts`
**Key method**: `callLlmForUser(userId, systemPrompt, userPrompt, usageContext?, options?)` — resolves key, routes to openai/gemini, logs usage.
**Supported providers**: `openai` (gpt-4o, gpt-4o-mini), `gemini` (gemini-2.0-flash, gemini-2.5-flash-preview)

## 4. Intervention-prompts pattern to follow

**Table**: `intervention_prompt_configs`
**Columns**: `courseId`, `interventionType` (enum), `teacherId`, `systemPrompt` (text), `isCustom` (boolean)
**Unique constraint**: `@@unique([courseId, interventionType])`
**Controller**: `apps/api/src/learning-interventions/learning-interventions.controller.ts`
**Pattern**: GET/PUT per `(courseId, interventionType)` pair.

EfConstructPrompt differs: versioned (never overwrite), `courseId` nullable (null = global default).

## 5. Teacher route pattern

**File**: `apps/web/src/App.tsx`
**Layout**: All teacher routes wrapped in `<ProtectedRoute><AuthenticatedLoggingWrapper><Layout /></...>`
**Role guard**: `<RoleRoute allowedRoles={['teacher', 'admin']}>`
**Data fetching**: `useState()` + `useEffect()` + `api.get()` / `api.post()` from `lib/api.ts`. NO react-query.
**Icons**: `lucide-react` (confirmed in package.json: `^0.575.0`)

## 6. Confirmed Prisma model names

| Concept          | Model             | ID type                            | Key fields                                                                           |
| ---------------- | ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Course           | `Course`          | UUID (`@default(uuid()) @db.Uuid`) | `id`, `title`, `teacherId`                                                           |
| Dialogue Session | `DialogueSession` | CUID (`@default(cuid())`)          | `id`, `studentId`, `courseId`, `title`                                               |
| Dialogue Message | `DialogueMessage` | CUID                               | `id`, `sessionId`, `role` (USER/ASSISTANT/SYSTEM), `content` (@db.Text), `createdAt` |
| User             | `User`            | UUID                               | `id`, `email`, `name`, `role`, `llmProvider`, `encryptedApiKey`                      |

## 7. Anything surprising / blocking

- **No react-query**: All data fetching uses manual `useState`+`useEffect`+`api.get()`. The text-mining dashboard should follow this pattern (no new deps).
- **DialogueMessage.sessionId is CUID** (not UUID): EfDetection.sessionId must match this type (plain String, not @db.Uuid).
- **DialogueGateway has no auth guard**: Socket.IO auth is client-side only. The new `/text-mining` namespace should follow the same pattern.
- **LLM keys stored on User model**, not a separate settings table. The `LlmService.callLlmForUser(userId, ...)` resolves everything. For detection, call with the course's `teacherId`.
- **Intervention prompts use upsert** (one row per courseId+type). EfConstructPrompt uses append-only versioning — different pattern.
