# Pre-study audit — GALS platform, study day 2026-06-13

> Read-only audit run on the morning of the study. Verdict, findings,
> smoke runbook, recommended actions, and what to monitor during the
> session. **Operator should triage the BLOCKER + HIGH list before
> participants log in.**

---

## 1. Executive summary

**Verdict: RUNNABLE WITH PRE-LAUNCH FIXES — do not start until the
BLOCKER and HIGH items below are triaged.** The core capture path
(activity log, biometric streams, recording, replay snapshots) has
writers wired, error-handling that restores buffers, and the recent
BUG_REPORT_20260612.md fixes look correct in code. However three
issues will silently degrade the data:

1. **The 6 BUG_REPORT_20260612 fixes (page-aware chat, Elab
   per-turn context, per-turn selection log) are STAGED BUT
   UNCOMMITTED in the working tree** (see `git status`). If the study
   runs from a different checkout / a docker rebuild from the last
   commit, the fixes WILL NOT BE PRESENT. Confirm before launch.
2. **DOM session replay is OFF by default** (`captureDom = false` in
   `LoggingProvider`). Pixel screenshots are still captured, but
   downstream HTML-based replay analysis will have empty `html`
   columns. If the analysis pipeline needs `html`, this is a
   BLOCKER.
3. **Failed webcam segment upload halts recording** — `recorder.onstop`
   only auto-restarts after the auto-rotation branch, not after a
   plain failed-upload. One transient network blip can pause webcam
   recording until the next tab visibility change.

The platform's session lifecycle, batch flush, snapshot upload, and
buffer-restore on retryable errors are correct. There are no
obvious data-loss paths IF the operator (a) lands the BUG_REPORT
commits, (b) verifies `captureDom`, and (c) checks the smoke-test
runbook in §6 below.

---

## 2. Findings by section

### Section 1 — Data capture path

#### 1.A `student_sessions` lifecycle [HIGH]
- **Open path:** `AuthService.login` → `SessionService.openSession`
  (`apps/api/src/auth/auth.service.ts:128`,
  `apps/api/src/activity-log/session.service.ts:31-63`). Creates row,
  emits `SESSION_START` activity event with `userId/courseId/ip/UA`.
  Solid.
- **Close on explicit logout:** `AuthService.logout` →
  `SessionService.closeSession` (auth.service.ts:142) — emits
  `SESSION_END`, computes `durationSecs`, builds `SessionSummary`,
  optionally triggers `analysis/export_logs.py`.
- **Close on browser tab close: BROKEN.**
  `apps/web/src/contexts/AuthContext.tsx:140-174` calls
  `/api/activity-log/session/close` ONLY in `logout()`. On
  `beforeunload` / `pagehide` /  `visibilitychange = hidden`, the
  activity-log provider
  (`apps/web/src/lib/activity-log/ActivityLogContext.tsx:119-150`)
  only flushes the in-memory batch. **There is no `session/close`
  fire from the unload handler.** Result: sessions where the
  student closes the tab without clicking Logout will never get
  `SESSION_END`, `durationSecs`, or `SessionSummary` populated until
  `closeSession` is called later — which never happens.
  **Impact:** every session for a student who closes the tab will
  show `endedAt = null`, no SESSION_END timeline anchor, and the
  derived summary will be missing. AOI scoring + alignment-score
  computations that key off `(SESSION_START, SESSION_END)` will see
  a half-open window.
- **Recommended mitigation:** before participants begin, instruct
  them explicitly to click the Logout button rather than close the
  tab. As a defence-in-depth, the operator can add a `session/close`
  `sendBeacon` to the existing pagehide handler (one-line change,
  but DO NOT modify code tonight without testing — see §4).

#### 1.B `activity_logs` writer error-handling [INFO]
`ActivityLogService.record()` and `recordBatch()`
(`apps/api/src/activity-log/activity-log.service.ts:39-95`) wrap the
Prisma create in a try/catch that **logs but does not rethrow**, so
all `void this.activityLogService.record(...)` call sites are
truly fire-and-forget — a transient Postgres failure logs a single
WARN line per event and is otherwise invisible. This is the intended
contract and matches the audit's brief. No silent swallowing
outside the catch.

#### 1.C Replay snapshots [HIGH]
- Capture: `apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts`.
  3 s periodic snapshot + triggered (route change, pagehide,
  beforeunload, visibility-hidden). HTML cap 5 MB, canvas-budget
  2.5 MB per snapshot, batch cap 8 MB.
- **DOM is OFF by default.** `LoggingProvider` mounts the recorder
  with `captureDom = false` (`apps/web/src/components/LoggingProvider.tsx:19`)
  and `App.tsx:71` does not override. The `html` column will be
  null for every snapshot. The recent storage-audit commit
  (`2e027ac`) is what flipped this — DELIBERATE for storage cost
  reasons. **If the study analysis needs DOM replay, this is a
  BLOCKER.** Pixel screenshots are still captured.
- Upload failure handling: `flush()` re-prepends the events back into
  the buffer on `.catch` (line 833-835), but on success the buffer
  is wiped. **Note the silent drop at line 906-908**: if the buffer
  grows past 15 events, the OLDEST get dropped. So a long network
  outage will lose snapshots silently — `bufferRef.current.splice(0,
  bufferRef.current.length - 15)`.
- Per-batch and per-canvas budgets look correct. The 12 MB API body
  limit (apps/api/src/main.ts) is comfortably above the 8 MB batch
  cap. Cross-origin / tainted canvases are skipped, the rest of the
  snapshot still ships.

#### 1.D `chatbot_messages.current_page` writer [INFO]
Migration `20260612000000_add_chatbot_message_selection_context`
adds `current_page INTEGER` (nullable, idempotent). The writer at
`learning-interventions.service.ts:4305-4346` writes
`pagePersist` on the USER row and `null` on the ASSISTANT row,
matching the spec. Frontend sends it from
`ChatbotPanel.tsx:408-411`. Bug 4 is correctly closed in code —
**but the migration only takes effect if it actually runs against
the study DB tonight.** See §3.B below for migration status check.

#### 1.E `dialogue_messages.tokenUsage` image/faithfulness fields [INFO]
`dialogue.service.ts:295-335` writes the full Stage 06 shape
(`promptTokens, completionTokens, imageCount, imageInputBytes,
faithfulnessFired, faithfulnessPassed, faithfulnessRegenerated`).
Verified.

#### 1.F Webcam recording segments [HIGH]
- `useWebcamRecording.ts:155-170` — `recorder.onstop` calls
  `uploadSegment` then restarts only when `isStoppingRef.current`
  (the auto-rotation path) is true.
- `uploadSegment` (lines 55-97) catches upload errors and PATCHes
  the segment to `/fail`. **It does not start a new segment.**
- Result: if a 50 MB segment auto-rotates and the upload of the
  previous segment fails, recording continues (good). But if
  recording stops for any OTHER reason and upload fails, recording
  is paused until `handleVisibilityChange` kicks in.
- `beforeunload` deliberately does NOT mark segments complete
  (line 219-227 comment) to avoid pointing rows at missing MinIO
  objects. This is correct.
- **Mitigation tonight:** ensure stable network, instruct
  participants not to background the tab for long. The post-study
  analysis pipeline should tolerate `status = FAILED` segments.

#### 1.G Pupil + WebGazer + emotion + AU [INFO]
- All four streams (`useWebgazer.ts`, `usePupilSize.ts`,
  `useEyeTracking.ts`, AU via py-feat worker output table) flush on
  a timer with the same pattern: try POST → on catch, `unshift`
  back to buffer. On `pagehide` / `visibilitychange`, they fire
  `fetch({ keepalive: true })` to drain. Errors logged, no silent
  drop. **Buffer is NOT bounded** — sustained outage will grow it
  unboundedly until the tab is closed (then keepalive ships what
  it can). Acceptable for a 1 h session.

#### 1.H `PRACTICE_TEST_CONFIGURED` emission [INFO]
Migration `20260603040000_add_practice_test_configured` adds the
enum value with `IF NOT EXISTS`. The emit fires at
`learning-interventions.service.ts:2149-2156`, immediately followed
by `INTERVENTION_TRIGGERED` (2158-2170), both inside the same
`if (sessionId)` block and in the right order. Both events get the
same `configMeta` payload so downstream analysis can join them.
Verified.

---

### Section 2 — Recent-change regression risk

#### 2.A BUG_REPORT_20260612 fixes are UNCOMMITTED [BLOCKER]
`git status` shows the six fixes from `docs/BUG_REPORT_20260612.md`
are staged in the working tree but **not committed**. The
migration directory
`apps/api/prisma/migrations/20260612000000_add_chatbot_message_selection_context/`
is untracked. If the study is launched from a fresh checkout, a
docker rebuild, or a CI artifact built from the last `master`
commit (`42e382a`), the fixes will not be present and Bugs 1-6
will reappear. **Operator MUST either commit the fixes and rebuild
the running containers, OR confirm the live containers have these
files mounted via the dev volume mount in `docker-compose.yml`
(lines 33-35).**

- Files modified: see `git status` (`apps/api/prisma/schema.prisma`,
  `chat-history.service.ts`, `chat.dto.ts`,
  `interrogative-elaboration.dto.ts`,
  `learning-interventions.service.{ts,spec.ts}`, `ChatbotPanel.tsx`,
  `ReviewTabView.tsx`, `InterrogativeElaborationView.tsx`,
  `ChatHistoryPage.tsx`).
- The dev docker-compose mounts `./apps/api/src`, `./apps/api/prisma`,
  and `./apps/web/src` directly, so a hot dev container WILL pick up
  the working tree as-is. A `pnpm dev` outside docker will too. A
  production-build container will not.

**Smoke check:** see §6, test #5 (PDF chat on slide 10 must answer
about slide 10, not slide 1).

#### 2.B Page-aware chat system prompt vs selection mode [INFO]
The new system-prompt addition at
`learning-interventions.service.ts:4236-4242` ("The student is
currently viewing slide N. If their highlighted selection appears
to come from a DIFFERENT slide than slide N, treat the selection as
the topic they want to discuss but answer the position question
based on their CURRENT viewing slide") is correctly worded to NOT
break selection-mode answers. Selection-mode is still discussed via
the highlighted text; only "which slide am I on" defers to
`currentPage`. Risk: minimal.

#### 2.C gals-studio + gals-export merge [LOW]
- `gals-studio/apps/studio-server` defaults to port 5174 (server) +
  5180 (web). `apps/web` runs on 5173. `apps/api` on 3000. No port
  collision.
- `gals-studio` uses its own SQLite at `~/.gals-studio/studio.db`
  (`studio-server/src/config.ts:14`). No DB shared with the main
  Postgres.
- `tools/gals-export/prisma/schema.prisma` is a standalone client
  for export and has its own `@prisma/client@6.19.2` pin
  (commit `9dda81c`). Confirm the version doesn't clash with the
  main api's pin if export is run in the same `node_modules` tree.
- **Action:** if the study uses gals-studio for replay viewing,
  start it independently AFTER the main stack is up; verify the
  STUDIO_SERVER env points to the right place.

#### 2.D `.sh` CRLF fix and `.gitattributes` [LOW]
- New `.gitattributes` exists at repo root (untracked). It pins
  `*.sh text eol=lf`, plus Dockerfiles + compose.
- Only two `.sh` files in the tree: `apps/api/start-dev.sh` and
  `.husky/_/husky.sh`. Both currently LF (verified via `file(1)`).
- **Untracked .gitattributes risk:** the fix only sticks if the
  operator commits it. A fresh clone today would NOT have these
  attributes and a Windows clone could re-introduce CRLF.

---

### Section 3 — Operational readiness

#### 3.A Feature flags [HIGH — verify before study]
| Flag | Default | Effect when default | Action |
|---|---|---|---|
| `RAG_MULTIMODAL_PDF` | **false** | PDF pages are text-chunked only — no per-page image embeddings or VLM caption. | Leave OFF for study (cheaper, no Cohere bill). |
| `RAG_MULTIMODAL_GENERATION` | **false** | Retrieved `page_image` / `figure` chunks fall back to caption-as-text. | Leave OFF unless multimodal answers are required. |
| `RAG_MAX_IMAGES_PER_CALL` | 4 | (only used when MULTIMODAL_GENERATION=on) | n/a |
| `RAG_FAITHFULNESS_CHECK` | **chat=off / intervention=on** | Per-surface default. Doubles latency on intervention turns. | Acceptable. |
| `RAG_USE_SHARED_RETRIEVER` | **true** | New shared retriever active. | Keep ON. |
| `RAG_TEACHER_EMBEDDINGS` | **true** | Teacher RAG embeds chunks. | Keep ON. |
| `RAG_PAGE_WINDOW` | **2** | Bug-fix #1 page window. | Keep at 2. |
| `RAG_CONTEXTUAL_RETRIEVAL` | **false** | Contextualizer service off — chunks fetched verbatim. | Leave OFF. |
| `RAG_ALLOW_PSEUDO_EMBEDDINGS` | **false** | Fail rather than silently substitute SHA256 vectors. | Keep OFF — silent pseudo-embed = corrupt retrieval. |
| `RAG_RERANK` | **false** | Noop reranker, RRF only. | Acceptable. |
| `ENABLE_SESSION_AUTO_EXPORT` | **false** | `closeSession` does NOT call `analysis/export_logs.py`. | Leave OFF for live study — run export manually after. |

To inspect effective values, `docker compose config | grep -E 'RAG_|LLM_|ENABLE_'` from the repo root (or `docker exec api env | sort`). The shipped `docker-compose.yml` does **not** export any of these — they all rely on defaults (above). If your `.env` file overrides any, double-check.

#### 3.B Database migration status [HIGH]
- `apps/api/prisma/migrations/` has 63 entries (62 timestamped + 1
  `migration_lock.toml`).
- Most recent on disk: `20260612000000_add_chatbot_message_selection_context`.
- **This migration is UNTRACKED** (see §2.A) — it exists locally
  but not in any commit. If the operator runs `prisma migrate
  status` after a fresh checkout, it WILL NOT KNOW about this
  migration and `chatbot_messages.current_page` will not exist.
- All other migrations in the directory ARE in the latest commit.
- **Action:** run
  `cd apps/api && pnpm exec prisma migrate status` against the
  study DB before the first participant logs in. Expected
  output: "Database schema is up to date!" If the new migration is
  not yet applied, run `pnpm exec prisma migrate deploy` (NOT
  `migrate dev` in production-shaped environments).

#### 3.C JWT secret [HIGH]
- `docker-compose.yml:14` defaults `JWT_SECRET` to
  `dev-secret-change-in-production`. If the operator has not set
  an override in their `.env`, every JWT in the study will be
  signed with a publicly known string. For a research study with
  no external network exposure this is acceptable; for any setup
  reachable from the internet this is a BLOCKER.
- `auth.module.ts:20` uses `getOrThrow` so a totally absent
  `JWT_SECRET` would refuse to start — meaning the only failure
  mode is "starts up with the default secret".

#### 3.D API keys present on the study teacher account [HIGH — verify]
The audit could not interrogate the database, but the teacher
record needs:
- `llmProvider` set (`openai` or `gemini`).
- `llmApiKey` encrypted and present (read by `LlmService.getUserApiKey`).
- `llmModel` set to a registry-current model id (not retired —
  `gemini-2.0-flash` was retired 2026-06-01; if still set, the
  read-time guard at `LlmService.callLlmForUser` substitutes the
  default + emits `console.warn`. See `LLM_VERIFICATION.md`
  guard #5).
- (Optional, for reranking) `cohereApiKey` set if `RAG_RERANK=true`.

SQL to verify before launch (replace `<email>`):
```sql
SELECT id, email, "llmProvider", "llmModel",
       ("llmApiKey" IS NOT NULL) AS has_llm_key,
       ("cohereApiKey" IS NOT NULL) AS has_cohere_key
FROM users WHERE email = '<email>';
```

#### 3.E Disk space + storage estimate [INFO]
- Replay snapshots: with `captureDom=false`, ~25-50 KB/snapshot
  (JPEG screenshot only), at 1 / 3 s = ~30-60 MB / hour per student.
- Webcam: WebM at 640×480 @ 15 fps ≈ 10-15 MB / minute = ~600-900
  MB / hour per student.
- Replay snapshots in DB only — webcam blobs in MinIO.
- **For 20 participants × 1 h sessions: ~12-18 GB MinIO, ~600 MB DB.**
- Current free space on the dev workstation: D: drive has 193 GB
  free. No risk for a 20-participant pilot. For N > 100 plan an
  archive/move-to-cold-storage step.

#### 3.F Workers [INFO]
- `pyfeat-worker` and `openface3-worker` both have `restart:
  unless-stopped` + 4 GB memory limit in `docker-compose.yml`
  (lines 122, 152).
- Health: workers don't expose HTTP healthchecks; verify via
  `docker compose ps` that both are `Up`. py-feat especially is a
  heavy boot — give the stack 60-90 s after `docker compose up
  --build` before flooding it with sessions.

---

### Section 4 — Privacy / safety

#### 4.A Secrets in source / logs [INFO]
- No `console.log` or `Logger.log` instances logging `password`,
  `JWT_SECRET`, `apiKey`, or `cohereApiKey` were found
  (grep + case-insensitive). API keys flow through `LlmService`
  decrypt + immediate consumption.
- `dev-secret-change-in-production` literal in `docker-compose.yml`
  and `.env.example` is intentional documentation, not a leak.

#### 4.B Passwords in API responses [INFO]
- `apps/api/src/auth/auth.service.ts:124` excludes `passwordHash`
  via destructure before returning login response.
- `auth.integration.spec.ts:40` asserts response has no
  `passwordHash` property — guard kept in CI.
- `user-management.service.ts` (5 writes to `passwordHash`) — every
  one is a setter. No findUser path returns it through the
  controller. The Prisma `select` is the implicit "all" which DOES
  include `passwordHash` — be aware that any new endpoint that
  forgets to omit it would leak. **No leak found in current
  surfaces** but future contributors should be told.

#### 4.C PII in LLM prompts [INFO]
- Audited `learning-interventions.service.ts` `buildElaborationAnswerPrompt`,
  `chat()` system prompt, and `dialogue.service.ts` system prompt
  — none of them include the student's email, `loginId`, or name.
  System prompts include `contentTitle` only.
- Activity log metadata sometimes carries `ipAddress` + `userAgent`
  (session open) but those don't reach an LLM.

#### 4.D Stale TODO / FIXME [INFO]
- `grep TODO|FIXME|XXX` over `apps/api/src/learning-interventions/`
  and `apps/web/src` returned nothing. Recent code is clean of
  these markers.

---

### Section 5 — Failure modes

#### 5.A LLM provider down / rate-limited [HIGH]
- **No request timeout is set** anywhere in `LlmService.callLlm` /
  `callOpenAiApi` / `callGeminiApi` (grep'd `AbortSignal|timeout`
  in `apps/api/src/rag/llm.service.ts`: zero matches). A hung
  provider will block the HTTP handler thread until the OS / load
  balancer kills the socket.
- The chatbot catches LLM errors at
  `learning-interventions.service.ts:4276-4279` and replies "I'm
  having trouble responding right now. Try selecting some text…".
  The student sees a graceful fallback BUT — note — this means a
  consistent LLM outage looks normal to the student. Operator
  should watch the API container logs for `LLM call failed`.
- Intervention generators do NOT have a silent fallback —
  `LLM_VERIFICATION.md` design note #1 confirms that any provider
  error on a JSON-mode call propagates to the student as an
  error. Good — research data shouldn't be silently swapped to
  template content.

#### 5.B MinIO full / unreachable [INFO]
- Webcam: presigned PUT to MinIO. If MinIO returns 5xx, the
  segment is marked `FAILED` and recording resumes only on the
  next visibility change. See §1.F.
- Replay screenshots: stored as data URLs in Postgres, NOT MinIO.
  MinIO full does NOT affect replay snapshots.
- RAG ingest: uploads to MinIO blob store. Failure aborts the
  upload + `SourceDocument.processingStatus = 'FAILED'`.

#### 5.C Postgres connection drops [INFO]
Prisma client auto-reconnects between queries. A connection drop
during a query throws; activity-log writers catch + log. Sessions
opened mid-outage are still recoverable via `studentSession` row
+ replayable activity events.

#### 5.D Tab backgrounded [INFO]
- Activity log flushes on `visibilitychange = hidden` via
  `keepalive: true` fetch
  (`ActivityLogContext.tsx:140-142`).
- Replay recorder fires a `'hidden'` snapshot then `flush(true)`
  (`useSessionReplayRecorder.ts:955-960`).
- Webcam recording STOPS on tab hidden, RESTARTS on visible
  (`useWebcamRecording.ts:208-217`) — this is by design.
- WebGazer continues running while tab is hidden (no
  visibilitychange handler in `useWebgazer.ts`), so gaze readings
  get written to localStorage / flushed lazily.

#### 5.E Tab closed mid-session [HIGH]
See §1.A. `SESSION_END` does **not** fire on `pagehide` /
`beforeunload`. Activity-log batch + replay snapshots + biometric
buffers DO flush via `keepalive`, so the data still lands — but
the session row never gets `endedAt` populated. **Mitigation:**
nightly cleanup script in `apps/api/scripts` (orphan-detection,
recently added in commit `1175d31`) — run after the study to
close orphaned sessions retroactively.

#### 5.F WebGazer calibration fails [LOW]
`CalibrationModal.tsx` displays a modal; if calibration is
skipped or fails, WebGazer still tracks but predictions are bad.
There is no gate that prevents the student from continuing.
**Acceptable for study** — calibration quality should be assessed
post-hoc via the `validity_mask` column.

---

## 3 (cont). Section 6 — Smoke test runbook

See next section.

---

## Section 6 — 10-test smoke runbook (run TONIGHT, in order)

Run on a clean browser profile. Each test takes < 90 s. Confirm
the SQL / DevTools check after each one before moving on.

### Test 1 — Login + session open
1. POST `/api/auth/login` (or use the login UI) as the study
   teacher.
2. Verify `localStorage.token` is present.
3. SQL:
   `SELECT id, "userId", "startedAt", "endedAt" FROM student_sessions
    ORDER BY "startedAt" DESC LIMIT 1;` — `endedAt` should be NULL.
4. SQL:
   `SELECT action FROM activity_logs WHERE "sessionId" = '<sid>'
    ORDER BY "occurredAt" ASC LIMIT 5;` — first event should be
   `SESSION_START`.

### Test 2 — Enrollment + course view
1. As a test student (NOT the teacher) join the study course (or
   confirm pre-enrolled).
2. Navigate to `/student/courses/:courseId`.
3. SQL:
   `SELECT action, "courseId", "moduleItemId" FROM activity_logs
    WHERE "sessionId" = '<sid>' AND action IN
    ('MODULE_OPENED','MODULE_ITEM_VIEWED') ORDER BY "occurredAt" DESC LIMIT 5;`

### Test 3 — Permission gate + biometrics opt-in
1. On the course page, the PermissionGate should prompt for
   webcam + screen-share.
2. Grant both. Verify the recording badge + WebGazer status
   badge are green.
3. SQL:
   `SELECT id, status, "startWallTime" FROM recording_segments
    WHERE "sessionId" = '<sid>' ORDER BY "startWallTime" DESC LIMIT 1;`
   — should be `ACTIVE`.

### Test 4 — PDF reader loads + page navigation
1. Open a PDF lesson with > 5 pages.
2. Scroll to slide 3.
3. DevTools: check `useSessionReplayRecorder` is firing — open
   Network tab, watch for `POST /api/logs/replay-snapshots`
   every ~10 s.
4. SQL:
   `SELECT "capturedAt", "pdfCurrentPage", "pdfTotalPages"
    FROM session_replay_snapshots WHERE "sessionId" = '<sid>'
    ORDER BY "capturedAt" DESC LIMIT 3;` — `pdfCurrentPage` should
   reflect the slide you're on.

### Test 5 — Text selection + main floating chatbot (the BUG_REPORT fix)
**This is the regression-prevention test for Bugs 1/5/6.**
1. On slide 10 of a multi-page PDF, open the floating Learning
   Assistant chatbot.
2. Type "what is this slide about?" and send.
3. Confirm the answer is ACTUALLY about slide 10's content
   (not slide 1's agenda).
4. SQL:
   `SELECT role, "currentPage", "selectedText", LEFT(content, 80)
    FROM chatbot_messages WHERE "studentSessionId" = '<sid>'
    ORDER BY "createdAt" DESC LIMIT 2;` — USER row should have
   `currentPage = 10`. **If `current_page` column doesn't exist
   → BLOCKER: migration not run.**

### Test 6 — All 4 interventions (smoke)
For each of PRACTICE_TESTING, INTERROGATIVE_ELABORATION,
STEPWISE_LEARNING, DISTRIBUTED_PRACTICE:
1. Trigger from the docked or floating chatbot.
2. Confirm content renders (questions / explanation / steps /
   cards).
3. SQL:
   `SELECT action, metadata->>'interventionType' AS type, "occurredAt"
    FROM activity_logs WHERE "sessionId" = '<sid>' AND action IN
    ('INTERVENTION_TRIGGERED', 'PRACTICE_TEST_CONFIGURED')
    ORDER BY "occurredAt" DESC LIMIT 10;` — all 4 types present,
   PRACTICE_TEST_CONFIGURED appears immediately before
   INTERVENTION_TRIGGERED for the PRACTICE_TESTING row.

### Test 7 — Elab per-turn page refresh (BUG_REPORT Bug 3)
1. Start an Interrogative Elaboration on slide 5.
2. Scroll to slide 8.
3. In the same Elab session ask "what is THIS slide about?".
4. Confirm the answer is about slide 8 (not slide 5).
5. SQL — fetch the intervention's `sessionData` JSON and confirm
   the latest user turn has `currentPage: 8` and a fresh
   `selectedText`.

### Test 8 — Dialogue mode + token usage
1. Open dialogue mode for the study course.
2. Send one message; receive reply.
3. SQL:
   `SELECT role, "tokenUsage", LEFT(content, 80) FROM dialogue_messages
    WHERE "sessionId" = '<dialogueSid>' ORDER BY "createdAt" DESC LIMIT 2;`
4. Assert the ASSISTANT row's `tokenUsage` JSON has
   `promptTokens`, `completionTokens`, `imageCount`,
   `faithfulnessFired` (these may be 0 / false but must be
   present).

### Test 9 — Replay tab + CSV export
1. As the teacher, navigate to the student-logs Replay tab for
   the session you just used.
2. Confirm the replay timeline shows SESSION_START,
   intervention markers, and at least one snapshot thumbnail.
3. Click Export CSV. Confirm the file downloads and has at
   least the `aoi_active_regions`, `pdf_current_page`,
   `scroll_top_*` columns populated.

### Test 10 — Logout closes the session
1. Click Logout (DO NOT just close the tab).
2. SQL:
   `SELECT "endedAt", "durationSecs" FROM student_sessions
    WHERE id = '<sid>';` — both should now be non-NULL.
3. SQL:
   `SELECT action FROM activity_logs WHERE "sessionId" = '<sid>'
    ORDER BY "occurredAt" DESC LIMIT 3;` — last event should
   be `SESSION_END`.

---

## Recommended pre-launch actions (in priority order)

1. **[BLOCKER] Commit the BUG_REPORT_20260612 fixes** (or
   confirm the live containers are mounted off the working tree).
   If commit-and-rebuild path: do it in dev BEFORE 17:00 today
   and re-run smoke tests 5 + 7.
2. **[BLOCKER, conditional] Decide on DOM replay.** If
   downstream analysis requires HTML snapshots, pass
   `captureDom={true}` to `LoggingProvider` in `App.tsx:71`. If
   not, the current pixel-only mode is fine.
3. **[HIGH] Verify the new migration is applied.** Run
   `cd apps/api && pnpm exec prisma migrate status` against the
   study Postgres. Run `migrate deploy` if needed.
4. **[HIGH] Set a real `JWT_SECRET`** in the operator's `.env`
   if the platform is reachable beyond localhost.
5. **[HIGH] Verify the study teacher's LLM config** with the SQL
   in §3.D. If `llmModel = 'gemini-2.0-flash'`, update to a
   selectable default.
6. **[HIGH] Instruct participants to LOGOUT** (don't close the
   tab) so sessions get cleanly closed. Add a slide / sticky
   note to the consent flow.
7. **[MEDIUM] Commit `.gitattributes`** so the CRLF fix doesn't
   regress on a fresh clone.
8. **[MEDIUM] Stop the studio + studio-web (if not needed
   during live capture).** Less surface area = fewer surprises.
9. **[LOW] Pre-warm the LLM provider** with one test call from
   the teacher account so the first student question doesn't
   pay cold-start latency.

---

## What to monitor DURING the study

Have these queries / dashboards open in a second window. Refresh
every 5-10 min.

### Dashboard A — live session healthcheck
```sql
SELECT s.id,
       u.email,
       s."startedAt",
       s."endedAt",
       NOW() - s."startedAt" AS age,
       (SELECT count(*) FROM activity_logs WHERE "sessionId" = s.id) AS events,
       (SELECT count(*) FROM session_replay_snapshots WHERE "sessionId" = s.id) AS snapshots,
       (SELECT count(*) FROM recording_segments WHERE "sessionId" = s.id) AS rec_segs
FROM student_sessions s
JOIN users u ON u.id = s."userId"
WHERE s."startedAt" > NOW() - INTERVAL '4 hours'
ORDER BY s."startedAt" DESC;
```
- Any row with `events = 0` after 2+ minutes → broken activity
  log.
- Any row with `rec_segs = 0` after 5+ minutes → recording not
  starting (likely permission denied or MinIO down).
- Any row with `snapshots = 0` after 1 minute → replay recorder
  off (verify LoggingProvider mount).

### Dashboard B — failed recording segments
```sql
SELECT id, "sessionId", status, error
FROM recording_segments
WHERE status = 'FAILED' AND "createdAt" > NOW() - INTERVAL '4 hours';
```
A non-zero count means MinIO trouble or upload timeouts. Triage
immediately.

### Dashboard C — LLM error rate
```sql
SELECT date_trunc('minute', "createdAt") AS minute,
       count(*) FILTER (WHERE model = 'template') AS template_fallbacks,
       count(*) FILTER (WHERE "totalTokens" = 0) AS zero_token_rows,
       count(*) AS total
FROM llm_usage_log
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY 1 ORDER BY 1 DESC;
```
- `template_fallbacks > 0` → the no-API-key fallback path fired,
  teacher LLM config is broken.
- `zero_token_rows / total > 0.05` → provider returning malformed
  responses; check api logs.

### Dashboard D — container health
- `docker compose ps` — all containers `Up (healthy)`.
- `docker stats --no-stream` — pyfeat / openface3 memory < 3.5 G
  (the 4 G limit is tight if both run hot).
- `docker logs api --tail 50` — watch for `LLM call failed`,
  `Failed to record activity log`, `MinIO put failed`.

### Dashboard E — chatbot freshness (Bug 1/5/6 regression watch)
```sql
SELECT "currentPage", count(*)
FROM chatbot_messages
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND role = 'USER' AND "moduleItemId" IS NOT NULL
GROUP BY 1 ORDER BY 1 NULLS LAST;
```
A high concentration of `currentPage IS NULL` on PDF-mode courses
means the frontend stopped sending `currentPage` → the BUG_REPORT
fix has regressed somehow.

---

## Appendix — File pointers used in this audit

- `apps/api/src/activity-log/session.service.ts`
- `apps/api/src/activity-log/activity-log.service.ts`
- `apps/api/src/activity-log/activity-log.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/jwt.strategy.ts`
- `apps/api/src/learning-interventions/learning-interventions.service.ts`
  (chat: 4080-4356; askQuestion: 2640-2730; PRACTICE_TEST_CONFIGURED:
  2149-2156)
- `apps/api/src/dialogue/dialogue.service.ts` (tokenUsage write:
  295-335)
- `apps/api/src/rag/shared/multimodal.flags.ts`
- `apps/api/src/rag/shared/multimodal-generation.flags.ts`
- `apps/api/prisma/migrations/20260612000000_add_chatbot_message_selection_context/migration.sql`
- `apps/web/src/contexts/AuthContext.tsx` (logout: 140-174)
- `apps/web/src/lib/activity-log/ActivityLogContext.tsx` (unload
  handlers: 119-150)
- `apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts`
  (buffer overflow: 906-908; failure handling: 833-835; canvas
  budget: 300-308)
- `apps/web/src/lib/recording/useWebcamRecording.ts` (upload
  failure handling: 81-94; onstop: 155-170)
- `apps/web/src/components/LoggingProvider.tsx`
- `apps/web/src/App.tsx:71` (LoggingProvider mount)
- `docker-compose.yml` (env defaults + healthchecks)
- `docs/BUG_REPORT_20260612.md`
- `LLM_AUDIT.md`, `LLM_VERIFICATION.md`
