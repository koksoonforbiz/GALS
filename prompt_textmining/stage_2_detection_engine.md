# Stage 2 — Detection engine, dialogue ingestion hook, default prompts

```
UI ICON REMINDER (full rule and icon map are in stage 1)
- No emoji anywhere — UI, strings, comments, prompts, LLM output.
- All icons from `lucide-react`. 16px in dense controls, 20px in primary
  affordances. Stroke width 1.75.
- Reuse the affordance->icon map from stage 1; add a new Lucide icon only
  if no existing one fits.


CONTEXT
Stage 1 added the schema and module skeleton. This stage makes detection
actually work end-to-end:
  - Hook into the existing dialogue message-creation flow so every new
    USER message triggers detection.
  - Run all 9 detectors concurrently per utterance, with a configurable
    semaphore.
  - Reuse the existing AI settings (OpenAI / Gemini keys + provider) —
    do NOT build a parallel key store.
  - Reuse the existing RAG retriever for engagement detection's course
    context — do NOT rebuild retrieval.
  - Persist results to EfDetection. Emit Socket.IO events for live updates.

STEP 1 — RE-RECON (light pass)

Open `text-mining-recon.md` from stage 1. Confirm:
  - The exact name and signature of the dialogue ingestion function and the
    RAG retriever. If your stage-1 recon was vague, fix it before writing
    code.

If you discover the AI settings module stores keys encrypted at rest, your
detection client must decrypt via the same helper. Do not invent a new one.

STEP 2 — DEFAULT PROMPTS

Create `apps/api/src/text-mining/detection/default-prompts.ts` with this
EXACT content (the prompts are pulled verbatim from the deep-research
feasibility map; do not paraphrase):

```ts
// Default per-construct LLM detection prompts. Edit via the teacher portal
// (stage 4) to override per-course; never edit this file to change behaviour
// for a single course — those edits would apply to every new course.
export const DEFAULT_PROMPTS: Record<string, string> = {
  metacognition_general: `Task: Decide whether the learner utterance below shows METACOGNITION — i.e., the learner is explicitly thinking about their own thinking, knowing, understanding, or learning.

Mark POSITIVE if the utterance:
  - uses a first-person pronoun (I, we, my, our) AND
  - references a cognitive state, process, or product (understand, know, think, remember, sure, confused, learn, figured out, realize, notice).
Examples of positive: "I'm not sure if I got this correct." / "I think I understand now." / "I don't remember how to start." / "We need to figure out what's missing."
Mark NEGATIVE if the utterance describes only object-level facts, asks a content question without self-reference, or expresses pure affect with no cognitive referent.
Examples of negative: "The answer is 42." / "What is X?" / "This is annoying."

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  metacognitive_monitoring: `Task: Decide whether the learner utterance shows METACOGNITIVE MONITORING — specifically, the learner verbalising awareness that something they did or thought is incorrect, incomplete, or mistaken.

Mark POSITIVE if the utterance contains:
  - explicit error recognition ("that's wrong", "I made a mistake", "that doesn't look right")
  - self-correction signals ("wait", "oh no", "actually no", "hmm that's not right")
  - doubt about own answer ("I don't think this is correct", "this doesn't add up")
Examples of positive: "It's incorrect. What's happened?" / "Wait, I divided when I should have multiplied." / "That can't be right."
Mark NEGATIVE if the utterance is content-execution, content-question, or non-error reflection.
Examples of negative: "The next step is to multiply." / "What does this term mean?"

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  attention_regulation: `Task: Decide whether the learner utterance signals ATTENTION REGULATION FAILURE / MIND-WANDERING — i.e., the learner reports their attention drifted from the task.

Mark POSITIVE if the utterance contains:
  - explicit task-unrelated thought ("I was thinking about lunch", "I keep zoning out")
  - reading-without-comprehending ("I read this paragraph three times and didn't take it in")
  - lost-place markers ("where was I", "wait, what was I doing")
Examples of positive: "I was thinking about lunch instead." / "I keep re-reading this and it's not going in." / "I just zoned out for a minute."
Mark NEGATIVE if the utterance shows on-task confusion, content-question, or simple silence. Confusion ("I don't get this") is NOT mind-wandering — only label positive if attention was reported as elsewhere.

WARNING: text-only detection of this construct has a published ceiling of kappa around 0.21. Treat outputs as noisy. Confidence should rarely exceed 0.6.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  // ORDINAL low/medium/high prompt — rewritten from the spreadsheet's
  // binary version because this app uses a 3-level scale.
  working_memory: `Task: Estimate WORKING-MEMORY LOAD for the adult learner who produced the utterance below, on a 3-level scale.

WARNING: WM capacity (a person-level trait) is NOT recoverable from text alone. WM LOAD (a moment-level state) is only weakly inferable from text. Treat outputs as noisy proxies.

Rate LOW if the utterance is fluent, on-track, and shows no signs of tracking difficulty.
Rate MEDIUM if the utterance shows mild reformulation, brief hesitation, or one self-correction.
Rate HIGH if the utterance contains:
  - lost-track markers ("wait, what was I doing?", "where was I?", "OK so back to...")
  - multiple mid-sentence reformulations or restarts
  - reference loss (pronouns without antecedent, abandoned clauses)
  - sudden syntactic simplification mid-task

Examples:
  LOW: "The mitochondrion produces ATP through oxidative phosphorylation."
  MEDIUM: "The answer is — hmm, let me think — I think it's 42."
  HIGH: "Wait, what was I supposed to do again? I had something but... never mind."

Output JSON only: {"label": "low" | "medium" | "high", "confidence": 0.0..1.0, "rationale": "<=20 words>", "warning": "text-only WM detection is weak; pair with keystroke / latency features for production use."}

Utterance: <<<INSERT_UTTERANCE>>>`,

  cognitive_flexibility: `Task: Decide whether the learner utterance signals COGNITIVE FLEXIBILITY (a strategic approach change), with the explicit caveat that this lexical signal is NOT validated as a measure of EF cognitive flexibility — it captures verbalised strategy switches, which may co-occur with set-shifting or with rote rhetorical moves.

Mark POSITIVE if the utterance contains:
  - a verbal pivot ("actually", "on second thought", "scratch that", "never mind")
  - explicit alternative-strategy framing ("let me try a different approach", "what if I instead...", "or I could...")
  - abandonment + restart ("that won't work — let me back up")
Examples: "Actually, that won't work — let me back up and try a different approach." / "On second thought, scratch that — alternatively I could..."
Mark NEGATIVE if the utterance is mere correction of a calculation slip (that's metacognitive monitoring) or content delivery without strategy change.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>", "warning": "surface marker; not validated as EF cognitive flexibility."}

Utterance: <<<INSERT_UTTERANCE>>>`,

  confusion: `Task: Decide whether the learner utterance below expresses CONFUSION — a perceived mismatch between what the learner expected and what they encountered, including not knowing how to proceed.

Mark POSITIVE if the utterance contains:
  - explicit non-understanding ("I don't get this", "I'm confused", "this makes no sense")
  - surprise-at-mismatch ("wait, why does this work?", "how can that be?")
  - verification questions where the learner is checking a conflict with their prior model ("do we assume X is zero?", "shouldn't this be Y instead?")
  - why/how-questions framed against an apparent contradiction
Examples: "Wait, I don't get why this works." / "I'm confused about the difference between mean and median." / "Why isn't pressure a function of theta and z?"
Mark NEGATIVE if the utterance is a pure factual request without expressed mismatch ("What's the formula for area?"), an emotional outburst without a content target, or a self-reported general lack of focus.

Optionally output a SEVERITY 1..5 (1 = mild puzzlement, 5 = blocked / cannot proceed) following MathDial conventions.

Output JSON only: {"label": "positive" | "negative", "severity": 1-5 | null, "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  frustration: `Task: Decide whether the learner utterance below expresses FRUSTRATION — a sustained negative affect arising from blocked progress on a task they care about.

Mark POSITIVE if the utterance contains:
  - expressions of being stuck for a while ("I've been on this forever", "still not working", "I keep getting it wrong")
  - exasperation markers ("ugh", "argh", repeated punctuation "why?!", expletives in service of the task)
  - give-up signals ("I give up", "just tell me the answer", "forget it")
  - repetition of prior complaints ("like I said, this isn't working")
Examples: "Ugh, I've been stuck on this forever." / "This makes no sense. I already told you that." / "Why isn't this working??" / "I give up."
Mark NEGATIVE if the utterance is brief confusion without sustained-blockage signal, or neutral content. Do not confuse boredom ("this is boring") with frustration (which is high-arousal and goal-directed).

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  engagement: `Task: Decide whether the learner utterance is ON-TASK or OFF-TASK relative to the current course / problem context.

Mark ON-TASK if the utterance:
  - engages with course content
  - builds on a peer's contribution
  - asks a content question or proposes a content step
Mark OFF-TASK if the utterance:
  - discusses unrelated topics ("anyone seen the new movie?")
  - is pure social chatter without content ("haha cool")
  - is meta-complaint without content target ("this class is so boring lol")
  - is a non-content procedural aside unrelated to the current step ("what time is lunch?")

Output JSON only: {"label": "on-task" | "off-task", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>
Course context: <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>`,

  boredom: `Task: Decide whether the learner utterance below expresses BOREDOM — a low-arousal negative affect characterised by lack of interest, perceived monotony, or wanting the activity to end.

Mark POSITIVE if the utterance contains:
  - explicit boredom self-disclosure ("I'm bored", "this is boring", "so boring")
  - criticising-coping markers ("can we do something else?", "this is tedious", "I'd rather do anything else")
  - restless waiting-for-end signals ("I can't wait for class to end", "how much longer")
  - daydreaming-from-monotony ("so boring I keep zoning out", "my mind keeps drifting")
Examples (verbatim from AEQ-S Bieleke 2021 and BROMP manuals): "The lecture bores me." / "This is boring." / "Can we do something else?" / "I would rather put off this boring work till tomorrow."
Mark NEGATIVE for: confusion (low-arousal but not boredom), frustration (high-arousal negative), terse one-word replies WITHOUT explicit boredom marker ("k", "next", "idk" — these correlate with disengagement but are NOT validated as boredom-positive in any published codebook).

WARNING: text-only boredom detection has a published ceiling of 69% binary accuracy (D'Mello 2008); GoEmotions excluded boredom due to low IRR. Treat outputs as high-precision-low-recall; default to negative on ambiguous cases.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,
};
```

On first boot, seed `EfConstructPrompt` with one row per construct where
`courseId = null` and `version = 1` and `promptText` = the corresponding
DEFAULT_PROMPTS entry. Skip seeding if rows already exist.

STEP 3 — LLM CLIENT (reuse existing AI settings)

Build `apps/api/src/text-mining/detection/llm-client.ts` exposing:

```ts
async function detectJson(args: {
  provider: 'openai' | 'gemini';
  model: string;
  prompt: string;
  utterance: string;
  context?: string;        // injected for engagement only
  apiKey: string;          // resolved from existing AiSettings, decrypted
  timeoutMs: number;       // default 8000
}): Promise<{ raw: string; parsed: unknown; latencyMs: number }>
```

Implementation:
  - Substitute `<<<INSERT_UTTERANCE>>>` and (for engagement)
    `<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>` in the prompt text.
  - For OpenAI: chat.completions with `response_format: { type: "json_object" }`.
  - For Gemini: `generationConfig.responseMimeType = "application/json"`.
  - Wrap with abort controller; on timeout return raw="<timeout>", parsed=null.
  - Do NOT log apiKey. Do NOT echo apiKey in error messages.

Resolve provider and key by calling the existing AI settings service:

  AiSettingsService.getActiveProvider(teacherId) -> { provider, model, decryptedKey }

If `EfTeacherSettings.detectionProviderOverride` is set, use that instead of
the chat provider. This lets a teacher run chat on `gpt-4o` and detection on
the cheaper `gpt-4o-mini`.

STEP 4 — DETECTION ORCHESTRATOR

`apps/api/src/text-mining/detection/detection.service.ts`:

```ts
async detectAllForMessage(args: {
  messageId: string;
  sessionId: string;
  studentId: string;
  courseId: string | null;
  teacherId: string;
  utterance: string;
}): Promise<EfDetection[]>
```

Behaviour:
  1. Load `EfTeacherSettings` for the teacher. If `pauseIngestion`, return [].
  2. Load the active prompt set:
       For each construct, pick the highest `version` row from
       `EfConstructPrompt` where `courseId = args.courseId`; fall back to
       `courseId = null` if no per-course override.
  3. If `disableLowFeasibility` is true, skip the four constructs whose
     feasibility <= 2 (attention_regulation, working_memory,
     cognitive_flexibility, boredom). For each skipped construct, do NOT
     persist a row at all. The dashboard will show "disabled" for these.
  4. Build the engagement context string:
       - Call the existing RAG retriever with `query = utterance`, `k = 2`,
         `sessionId = args.sessionId`.
       - Concatenate the top 2 chunks (truncate to ~500 chars total) as a
         brief topic summary. Prefix with the course title and the current
         dialogue session's title if available.
       - If retrieval yields nothing or fails, substitute the literal
         string "(no course material indexed)".
       - Cache this string for the duration of the batch — all constructs
         in the same batch share it (only engagement uses it; computing
         once is wasteful but trivial).
  5. Run all enabled constructs concurrently with a semaphore of size
     `EfTeacherSettings.detectionConcurrency` (default 6). Use a
     properly-disposable semaphore primitive (e.g., `p-limit`).
  6. For each construct, call `detectJson(...)`. On parse failure or
     timeout, persist label="error" with the raw response in `rawJson`.
     Do NOT throw out of the batch — one failed construct must not block
     the other eight.
  7. Persist results in a single `prisma.efDetection.createMany`.
  8. Emit Socket.IO events to room `session:<sessionId>`:
       - One `ef.detection.created` event per persisted row (frontend
         streams them in).
       - One `ef.detection.batch.completed` event when the whole batch
         finishes, with `{ messageId, constructKeys: [...] }`.

Total wall-clock target: under 3 seconds for 9 calls on `gpt-4o-mini` or
`gemini-2.0-flash`. If routinely longer, lower concurrency hurts; widen the
semaphore instead. Tune based on observed P95.

STEP 5 — DIALOGUE INGESTION HOOK

In the dialogue service identified in stage-1 recon (the function that
persists a USER-role DialogueMessage), inject the new
`TextMiningService` and call:

```ts
// Fire-and-forget — never block the chat round-trip on detection latency.
// The chat reply must stream back as it does today.
this.textMining.ingest({
  messageId: newMessage.id,
  sessionId: newMessage.sessionId,
  studentId: newMessage.userId,
  courseId: session.courseId,
  teacherId: course.teacherId,    // or however the platform resolves "owning teacher"
  utterance: newMessage.content,
}).catch(err => this.logger.error('text-mining ingest failed', err));
```

`TextMiningService.ingest(...)` should:
  - Persist 9 placeholder `EfDetection` rows with `label="pending"` immediately,
    so the dashboard knows work is in flight. (Skip placeholders for
    disabled constructs.)
  - Kick off `detectAllForMessage(...)` on the next microtask.
  - When `detectAllForMessage(...)` completes, replace the placeholder rows
    via `updateMany` keyed by `(messageId, constructKey)`.

Important: DO NOT modify the dialogue message DTO returned to the student.
Detection is teacher-side only — students should not see EF labels in their
chat UI.

STEP 6 — REPROCESS ENDPOINT (admin retry)

`POST /api/text-mining/sessions/:sessionId/reprocess`

  Body: { constructKeys?: string[]; sinceMessageId?: string; }
  Auth: admin OR the session's owning teacher.
  Behaviour: enumerate user-role messages in the session, optionally filter
  by `sinceMessageId`, optionally filter to specific constructs, and
  re-run detection. Use a job queue if the platform has one (Redis-backed,
  per the architecture summary); otherwise process inline with a hard cap
  (e.g., 200 messages) and surface progress via Socket.IO to the
  reprocess-initiator's room.

CONFIRMATION CHECKLIST FOR STAGE 2
  [ ] Default prompts seeded; one row per construct exists with `courseId = null`, `version = 1`.
  [ ] Sending a USER message in dialogue creates 9 detection rows within 3 seconds (placeholders, then real labels).
  [ ] Engagement detection receives course context from the existing retriever (verify by logging the substituted prompt at debug level).
  [ ] Working-memory rows have `label` in {low, medium, high}, never `positive`.
  [ ] A construct that errors does not block the other eight.
  [ ] Socket.IO events fire on the session room.
  [ ] Pausing ingestion via `EfTeacherSettings.pauseIngestion` immediately stops new detections.
  [ ] Reprocess endpoint works on a session with 5+ messages.
  [ ] No emoji anywhere in any new file.

Do NOT proceed to stage 3 until the above is green.
```


---

## Navigation

- Previous: [stage_1_reconnaissance.md](stage_1_reconnaissance.md) — Codebase audit, Prisma schema, NestJS module skeleton.
- Next: [stage_3_dashboard.md](stage_3_dashboard.md) — Teacher dashboard tab, per-construct rows, trace drawer, live updates.
