# Stage 1 — Platform reconnaissance, Prisma schema, NestJS module skeleton

```
UI ICON RULE (read once, follow always for every stage that adds UI)
- NO EMOJI anywhere — UI, source code strings, JSX/HTML attributes, comments,
  system prompts, or LLM-generated content shown to users.
- All icons MUST come from `lucide-react` (already in the platform's frontend
  deps — confirm in `package.json` first; install only if missing).
- Default size 16px in dense controls (table cells, badges, inline buttons),
  20px in primary affordances (page headers, modal CTAs, toolbars). Stroke 1.75.
- `aria-hidden="true"` on decorative icons; pair meaningful icons with visible
  text or `aria-label` on the parent control.

CANONICAL AFFORDANCE -> LUCIDE ICON MAP (use these unless one truly does not fit):

  Settings gear                         -> Settings
  Info / tooltip trigger                -> Info
  Warning (low-feasibility construct)   -> TriangleAlert
  Detection - positive / on-task        -> CircleCheck
  Detection - negative / off-task       -> CircleX
  Detection - error                     -> CircleAlert
  Detection - pending / in-flight       -> Loader2 (with `animate-spin`)
  Working-memory low                    -> SignalLow
  Working-memory medium                 -> SignalMedium
  Working-memory high                   -> SignalHigh
  Confusion severity gauge              -> Gauge
  Drill-in / open detail drawer         -> ChevronRight
  Drawer / modal close                  -> X
  Filter / facet                        -> Filter
  Search                                -> Search
  Sort ascending / descending           -> ArrowUpAZ / ArrowDownAZ
  Refresh                               -> RefreshCw
  Export CSV                            -> Download
  Copy to clipboard                     -> Copy
  Reset to default                      -> RotateCcw
  Save                                  -> Save (text label is enough on primary CTAs)
  Show / hide API key                   -> Eye / EyeOff
  Connection - reachable                -> Plug
  Connection - unreachable              -> Unplug
  Empty state                           -> Inbox
  Test connection - pass                -> CircleCheck
  Test connection - fail                -> CircleX
  Per-construct edit prompt             -> Pencil
  Try-it tester                         -> FlaskConical
  Trace-back / history                  -> History
  Per-utterance jump (link to message)  -> ExternalLink
  Pause / resume detection ingestion    -> Pause / Play
  Channel: text-derived                 -> MessageSquare
  Channel: biometric-derived            -> Camera

Whenever you would have reached for an emoji (check, cross, warning, trash,
magnifying glass, star, fire), use the Lucide equivalent above.


CONTEXT
You are adding an EF / learning-construct text-mining feature to an existing
adaptive tutoring system. The platform is built and live. Your job in this
stage is: (1) audit the existing code so you reuse infrastructure rather
than duplicate it, (2) add new Prisma models for detection storage and
configuration, (3) generate a NestJS module skeleton that other stages will
fill in.

DO NOT WRITE ANY DETECTION LOGIC IN THIS STAGE. Only the schema, the module
skeleton with stubbed endpoints, and the wiring. Detection comes in stage 2.

STEP 1 — RECONNAISSANCE (mandatory before writing any code)

Read the following paths and write a short `text-mining-recon.md` file at
the repo root summarising what you found. Do not skip this — later stages
depend on getting the integration points right.

  Backend (NestJS):
    - `apps/api/src/app.module.ts` (or equivalent root module) — confirm
      module-loading pattern, global pipes/guards.
    - The dialogue module — search for files matching
      `**/dialogue*.module.ts`, `**/dialogue*.service.ts`,
      `**/dialogue*.controller.ts`, `**/dialogue*.gateway.ts`.
      Identify:
        a. The function that PERSISTS a new student message (USER role).
           This is our hook point.
        b. The Socket.IO gateway that streams dialogue chunks. We will add
           a parallel `text-mining` gateway that emits detection events.
        c. The retrieval service used during dialogue (RAG over uploaded
           sources). We will reuse it for engagement-construct context.
    - The teacher AI settings module — search `**/ai-settings*.*` and the
      route handler behind `/teacher/ai-settings`. Identify:
        a. How API keys are stored (encryption, table/column).
        b. Which providers are already supported (`openai` and/or `gemini`).
        c. The DTO/shape used to set provider + model.
      We will REUSE this exact storage rather than create a parallel one.
    - The intervention prompts module — search for the handler behind
      `/teacher/courses/:courseId/prompts`. Note the table/columns for
      per-course editable prompts. Our per-construct prompt editor in
      stage 4 will follow the same pattern.

  Frontend (React + Vite):
    - `apps/web/src/routes/*` (or wherever React Router routes live) —
      list the existing teacher routes under `/teacher/*`.
    - The page behind `/teacher/students/:studentId/logs` — note its
      layout, filters, table component, and how it loads paginated data.
      Our dashboard in stage 3 will follow the same look-and-feel.
    - The page behind `/teacher/ai-settings` — note the form pattern,
      how API keys are masked, how "test connection" works (if it exists).
    - `package.json` — confirm `lucide-react` is installed (per the
      icon rule above). Confirm `@tanstack/react-query` (or whatever
      data-fetching lib) is in use; reuse it rather than introducing a
      new one.

  Database (Prisma):
    - `apps/api/prisma/schema.prisma` — list the existing models for
      `Course`, `DialogueSession`, `DialogueMessage` (or whatever the
      message model is called), `User`, and the AI settings model.
      Note the exact field names for `id`, `sessionId`, `role`, `content`,
      `createdAt`. We will reference these as foreign keys.

Write `text-mining-recon.md` with sections:
  1. Hook point for ingesting student utterances (file + function name).
  2. Existing RAG retriever to reuse (file + function name + signature).
  3. AI settings storage location (table + columns + encryption details).
  4. Intervention-prompts pattern to follow (table + columns).
  5. Teacher route pattern (folder layout + data-fetching approach).
  6. Confirmed Prisma model names for: Course, DialogueSession, DialogueMessage, User, AiSettings.
  7. Anything surprising / blocking.

STOP AFTER RECON IF YOU CANNOT FIND any of points 1–6 and ask before guessing.

STEP 2 — PRISMA SCHEMA ADDITIONS

Add to `prisma/schema.prisma`. Use the existing repo's naming convention
(camelCase fields, PascalCase models, `@@map` if other models use it).

Models to add:

  model EfDetection {
    id            String   @id @default(cuid())
    messageId     String                     // FK -> DialogueMessage.id (use the actual model name from recon)
    sessionId     String                     // FK -> DialogueSession.id, denormalised for fast dashboard queries
    studentId     String                     // FK -> User.id, denormalised for student-level rollups
    courseId      String?                    // FK -> Course.id, denormalised
    constructKey  String                     // one of the nine keys; index for filter
    label         String                     // "positive"|"negative"|"on-task"|"off-task"|"low"|"medium"|"high"|"error"|"pending"
    confidence    Float?
    severity      Int?                       // confusion-only, 1..5
    rationale     String?
    warning       String?                    // populated for working_memory and cognitive_flexibility
    rawJson       Json?                      // full LLM response for audit
    provider      String                     // "openai"|"gemini"
    model         String                     // e.g. "gpt-4o-mini"
    promptVersion Int                        // FK -> EfConstructPrompt.version (denorm; null only if pending)
    latencyMs     Int?
    createdAt     DateTime @default(now())

    @@index([sessionId, constructKey, createdAt])
    @@index([studentId, constructKey, createdAt])
    @@index([messageId])
  }

  model EfConstructPrompt {
    id            String   @id @default(cuid())
    courseId      String?                    // null = global default; per-course override otherwise
    constructKey  String
    promptText    String                     // includes <<<INSERT_UTTERANCE>>> and possibly <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>
    version       Int                        // monotonically increases per (courseId, constructKey)
    updatedBy     String                     // FK -> User.id (teacher who edited)
    updatedAt     DateTime @updatedAt
    createdAt     DateTime @default(now())

    @@unique([courseId, constructKey, version])
    @@index([courseId, constructKey])
  }

  model EfTeacherSettings {
    id                       String   @id @default(cuid())
    teacherId                String   @unique     // FK -> User.id
    rollingWindowN           Int      @default(5) // 2..50
    detectionConcurrency     Int      @default(6) // 1..10
    disableLowFeasibility    Boolean  @default(false) // skips the 4 weakest constructs
    detectionProviderOverride String?             // null = use existing AiSettings; override only if teacher wants different model for detection vs chat
    detectionModelOverride   String?
    pauseIngestion           Boolean  @default(false) // emergency switch — stops all detection until teacher resumes
    updatedAt                DateTime @updatedAt
  }

After editing the schema, generate a migration:
    npx prisma migrate dev --name add_ef_detection
Run `prisma generate` if your CI script does not do it automatically.

STEP 3 — NESTJS MODULE SKELETON

Create a new module under the same path convention the rest of the API uses
(probably `apps/api/src/text-mining/`):

  text-mining.module.ts
  text-mining.controller.ts        — HTTP endpoints (stubs, return 501)
  text-mining.gateway.ts           — Socket.IO gateway for live dashboard
  text-mining.service.ts           — orchestration; mostly empty stubs
  detection/
    constructs.ts                  — the nine-construct table; export typed `CONSTRUCTS` array (see below)
    detection.service.ts           — stub; real impl in stage 2
    default-prompts.ts             — empty for now; populated in stage 2
  prompts/
    prompts.service.ts             — CRUD for EfConstructPrompt
  dashboard/
    dashboard.service.ts           — stub aggregator; real impl in stage 3
  settings/
    teacher-settings.service.ts    — CRUD for EfTeacherSettings
  dto/
    *.dto.ts                       — request DTOs with class-validator decorators

Register the module in the root AppModule (or the equivalent root module the
recon identified).

`constructs.ts` must export this exact list (typed):

THE NINE CONSTRUCTS (hard-code these keys exactly; do not rename or extend):

| key | display_name | label_type | feasibility | topic_specific | needs_retrieval | warning |
|---|---|---|---|---|---|---|
| metacognition_general | Metacognition (general) | binary | 5 | false | false | null |
| metacognitive_monitoring | Metacognitive monitoring | binary | 5 | false | false | "Cross-domain transfer drops AUC 0.10–0.20" |
| attention_regulation | Attention / mind-wandering | binary | 2 | false | false | "Text-only kappa ceiling around 0.21" |
| working_memory | Working memory load | ordinal | 2 | false | false | "Text-only WM detection is weak; pair with keystroke features for production" |
| cognitive_flexibility | Cognitive flexibility | binary | 1 | false | false | "Surface marker; not validated as EF set-shifting" |
| confusion | Confusion | binary | 5 | false | false | null |
| frustration | Frustration | binary | 4 | false | false | null |
| engagement | Engagement / off-task | engagement | 4 | true | true | null |
| boredom | Boredom | binary | 2 | false | false | "GoEmotions excluded boredom; D'Mello 2008 ceiling 69%" |

Output schemas by label_type:
  - binary       -> {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": str, "severity": int|null (severity ONLY for confusion)}
  - ordinal      -> {"label": "low" | "medium" | "high", "confidence": 0.0..1.0, "rationale": str, "warning": str}
  - engagement   -> {"label": "on-task" | "off-task", "confidence": 0.0..1.0, "rationale": str}


Build a TypeScript const `CONSTRUCTS` of type:

  type LabelType = 'binary' | 'ordinal' | 'engagement';
  interface Construct {
    key: string;
    displayName: string;
    labelType: LabelType;
    feasibility: 1 | 2 | 3 | 4 | 5;
    topicSpecific: boolean;
    needsRetrieval: boolean;
    warning: string | null;
  }

The same shape must be reachable from the frontend. Easiest: expose a
GET `/api/text-mining/constructs` endpoint and have the frontend fetch it
once at mount; do NOT duplicate the list in TS source on both sides.

HTTP ENDPOINTS TO STUB (each returns 501 with `// TODO stage N` comment):

  GET    /api/text-mining/constructs                         — returns CONSTRUCTS
  GET    /api/text-mining/sessions/:sessionId/dashboard      — stage 3
  GET    /api/text-mining/sessions/:sessionId/detections     — stage 3
        ?constructKey=&label=&from=&to=&cursor=&limit=
  GET    /api/text-mining/students/:studentId/dashboard      — stage 3 (cross-session rollup)
  GET    /api/text-mining/courses/:courseId/prompts          — stage 4
  PUT    /api/text-mining/courses/:courseId/prompts          — stage 4
  POST   /api/text-mining/courses/:courseId/prompts/reset    — stage 4
  POST   /api/text-mining/prompts/try                        — stage 4
  GET    /api/text-mining/teacher-settings                   — stage 4
  PUT    /api/text-mining/teacher-settings                   — stage 4
  POST   /api/text-mining/sessions/:sessionId/reprocess      — stage 2 (admin-only retry)

Apply the existing platform's auth guards (JWT + role-based teacher-or-admin).
Reuse the existing decorators rather than introducing new ones.

WEBSOCKET GATEWAY (skeleton only)

  Namespace: `/text-mining` (or whatever convention the platform uses).
  Rooms:
    `session:<sessionId>` — joined by teachers viewing that session's
                            dashboard. Emit `ef.detection.created` and
                            `ef.detection.batch.completed` events on each
                            new utterance ingestion (real impl in stage 2).
  Auth: reuse the existing Socket.IO JWT guard.

CONFIRMATION CHECKLIST FOR STAGE 1
  [ ] `text-mining-recon.md` exists at repo root and answers all 7 questions.
  [ ] Prisma migration applied without breaking existing tables.
  [ ] `npx prisma generate` succeeds.
  [ ] NestJS app boots locally with the new module loaded.
  [ ] GET /api/text-mining/constructs returns the nine-construct list.
  [ ] All other endpoints return 501 with TODO markers.
  [ ] No emoji in any new file. No new icon library installed.

DO NOT proceed to stage 2 until this checklist is green.
```


---

## Navigation

- Next: [stage_2_detection_engine.md](stage_2_detection_engine.md) — Default prompts, LLM client, dialogue hook, 9-construct orchestrator.
