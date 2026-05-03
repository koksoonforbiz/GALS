# Stage 4 — Per-construct prompt editor and teacher settings

```
UI ICON REMINDER (full rule and icon map are in stage 1)
- No emoji anywhere — UI, strings, comments, prompts, LLM output.
- All icons from `lucide-react`. 16px in dense controls, 20px in primary
  affordances. Stroke width 1.75.
- Reuse the affordance->icon map from stage 1; add a new Lucide icon only
  if no existing one fits.


CONTEXT
Stages 1–3 produced a working detector and dashboard using the seeded
default prompts. This stage adds the teacher-facing controls to:
  - tweak per-construct prompts (with few-shot examples baked in already);
  - choose a different LLM model for detection vs. chat (optional);
  - tune the rolling-window N, concurrency, and disable-low-feasibility flag;
  - test a prompt against a sample utterance before saving.

DO NOT add a parallel "API keys" UI. The existing `/teacher/ai-settings`
page already manages provider selection and key entry. Reuse it. The text-
mining settings page LINKS to it for key management and reads the configured
provider from there.

NAVIGATION

  - Extend the existing `/teacher/ai-settings` page with a new section
    "Text-mining detection" near the bottom. This section contains:
      - A model-override pair (provider + detection-model dropdown). When
        empty, falls back to the chat provider/model. Save targets
        `EfTeacherSettings.detectionProviderOverride` and `.detectionModelOverride`.
      - The rolling-window N input (`rollingWindowN`).
      - The detection-concurrency input (`detectionConcurrency`,
        collapsible "Advanced").
      - The "Disable low-feasibility detectors" checkbox
        (`disableLowFeasibility`). Tooltip: "Skips the four lowest-feasibility
        constructs. Saves about 45% of detection API cost."
      - The pause/resume switch (`pauseIngestion`) with a Pause/Play icon.
      - A button "Edit per-construct prompts" that links to the new prompts
        page below.
  - Create a new page `/teacher/courses/:courseId/text-mining/prompts`.
    This is the per-construct prompt editor, scoped to one course.
    Reuse the layout pattern from the existing
    `/teacher/courses/:courseId/prompts` (intervention prompts) page.

PROMPT EDITOR PAGE

Layout:
  - Top of page: course name, breadcrumb back to course.
  - Subtitle: "These prompts override the global defaults for this course only."
  - Reset-all button (RotateCcw icon): "Reset all prompts to defaults" with
    a confirm dialog.
  - One collapsible section per construct (9 sections). Each shows:
      - Construct name + feasibility badge (1..5, red <=2 / amber 3 / green >=4).
      - Channel: "from dialogue" badge.
      - Warning text if the construct has one (TriangleAlert + warning copy).
      - Status: "default" (unedited), "customised v3" (showing the version),
        or "draft (unsaved)".
      - Body of the section:
          - A monospace textarea, 16+ visible rows, full width, pre-filled
            with the current prompt. Use the platform's standard code-editor
            component if available (the architecture summary hints at a
            content editor; otherwise plain `<textarea>` is fine — do not
            add a heavyweight editor like CodeMirror just for this).
          - Helper text:
            "Required placeholder: <<<INSERT_UTTERANCE>>>"
            "Engagement also requires: <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>"
            Expected JSON output schema for the construct (different for
            binary, ordinal, engagement — render from CONSTRUCTS).
          - Try-it tester: an input field for a sample utterance + a
            "Run" button (FlaskConical icon). Calls
            POST /api/text-mining/prompts/try; renders the parsed JSON
            below. Does NOT save anything to the session detection table.
          - Buttons (right-aligned):
              - "Save" (disabled until the textarea has been edited; calls
                PUT /api/text-mining/courses/:courseId/prompts).
              - "Reset to default" (RotateCcw): drops the per-course
                override row; the next detection will fall back to global
                defaults. Confirm dialog first.
          - Validation on save:
              - Must contain `<<<INSERT_UTTERANCE>>>`.
              - For engagement, must additionally contain
                `<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>`.
              - Reject empty / whitespace-only.
              - Show inline errors above the buttons.

ENDPOINTS (replace stage-1 stubs)

  GET /api/text-mining/courses/:courseId/prompts
    Returns the active prompt set for a course, where each construct shows
    either a per-course override or the global default:
    {
      "prompts": {
        "metacognition_general": {
          "promptText": "...",
          "version": 1,
          "isDefault": true,
          "lastEditedBy": null,
          "lastEditedAt": null
        },
        "confusion": {
          "promptText": "...customised...",
          "version": 3,
          "isDefault": false,
          "lastEditedBy": "user_xyz",
          "lastEditedAt": "..."
        },
        ...
      }
    }

  PUT /api/text-mining/courses/:courseId/prompts
    Body: { "constructKey": "...", "promptText": "..." }
    Behaviour:
      - Validate placeholders.
      - Insert a NEW EfConstructPrompt row with `version = max(existing) + 1`.
        Never overwrite. Old versions are kept for audit (a future detection
        row references its `promptVersion`).
      - Return the new version number.
    Auth: course owner OR admin.

  POST /api/text-mining/courses/:courseId/prompts/reset
    Body: { "constructKey"?: "..." }
    If `constructKey` is omitted, deletes ALL per-course prompt rows for
    this course (next detection falls back to global default for each).
    If provided, deletes just that construct's override.
    Auth: course owner OR admin.

  POST /api/text-mining/prompts/try
    Body:
      {
        "constructKey": "...",
        "promptText": "...",
        "utterance": "...",
        "courseContext"?: "..."   // optional; used for engagement
      }
    Resolves provider/key from the existing AI settings (with detection
    overrides), runs ONE detection call, returns:
      {
        "raw": "<llm response>",
        "parsed": { "label": "...", ... } | null,
        "parseError": "..." | null,
        "latencyMs": 0,
        "model": "..."
      }
    Does NOT persist to EfDetection.
    Rate-limit per teacher to (e.g.) 30 calls per minute to prevent abuse.

  GET /api/text-mining/teacher-settings
    Returns the EfTeacherSettings row for the current teacher (creating
    one with defaults if missing).

  PUT /api/text-mining/teacher-settings
    Body: any subset of { rollingWindowN, detectionConcurrency,
                        disableLowFeasibility, pauseIngestion,
                        detectionProviderOverride, detectionModelOverride }
    Validation:
      - rollingWindowN in 2..50
      - detectionConcurrency in 1..10
      - if detectionProviderOverride is set, must be 'openai' or 'gemini'
        and the corresponding key must already be configured in AI settings.

CONNECTION CHECK

In the AI settings page near the new text-mining section, add a "Test
detection" button that runs a one-off detection call against the prompt
"This is so confusing." with the `confusion` prompt and the configured
detection model. Render pass/fail with CircleCheck/CircleX. This gives the
teacher a fast sanity check that the wire-up works without burning through
real student utterances.

PROMPT VERSIONING + AUDIT

Every persisted EfDetection has a `promptVersion`. The dashboard's trace
drawer should already show this from stage 3. Now add: clicking the
version number in the trace drawer opens a small modal that displays the
exact prompt text that produced that detection, so the teacher can verify
why a label came out the way it did weeks after a prompt was changed.

  GET /api/text-mining/courses/:courseId/prompts/:constructKey/versions/:version
    Returns the historical prompt text for that exact version.

EMPTY-STATE / ONBOARDING

If a teacher opens the prompts page for a course with zero detections so
far, render a top banner: "Tip: prompts only apply to NEW utterances. To
re-score existing dialogue, use 'Reprocess session' from the session
timeline." Link to the reprocess button surfaced in stage 3's session tab.

CONFIRMATION CHECKLIST FOR STAGE 4
  [ ] AI settings page has a new "Text-mining detection" section that saves rolling-N, concurrency, disable-low-feas, pause, and detection-model override.
  [ ] Per-course prompts page renders 9 collapsible construct sections with current prompt text pre-filled.
  [ ] Editing and saving a prompt creates a new EfConstructPrompt row with incremented version; the previous version is preserved.
  [ ] "Try it" runs a one-off detection without persisting anything.
  [ ] "Reset to default" for one construct drops the override; next detection uses the global default.
  [ ] Validation blocks save when <<<INSERT_UTTERANCE>>> is missing or, for engagement, the course-context placeholder is missing.
  [ ] "Test detection" button on AI settings exercises the full wire-up.
  [ ] Trace drawer prompt-version link shows the exact historical prompt text.
  [ ] Page-reload preserves all settings, prompt edits, dashboard state.
  [ ] No emoji anywhere; only lucide-react icons.
```


---

## Navigation

- Previous: [stage_3_dashboard.md](stage_3_dashboard.md) — Teacher dashboard tab, per-construct rows, trace drawer, live updates.
