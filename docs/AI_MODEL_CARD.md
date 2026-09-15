# GALS AI Model Card

Satisfies SMU Cybersecurity Checklist items 54-56 (training data provenance,
safety alignment, model documentation) and gives context for items 61-65 (data
handling, prompt-injection defenses, output moderation, limitations disclosure).

## What GALS uses AI for

Every AI-facing feature in GALS — the student chatbot, dialogue mode, question
generation, and content-drafting tools — is a thin orchestration layer over a
third-party hosted large language model. **GALS trains nothing.** There is no
fine-tuning pipeline, no training dataset, and no model weights anywhere in this
repository; confirmed by reading the full LLM call path in `apps/api/src/llm/`
and `apps/api/src/rag/`.

## Models in use

Configured centrally in `apps/api/src/llm/model-registry.ts` — that file is the
single source of truth; this table is a snapshot and will drift, so treat the
registry as authoritative for exactly which model IDs are currently selectable.

| Provider    | Example models                                                                     | Notes                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| AWS Bedrock | `global.openai.gpt-5.6-terra`/`sol` (chat), `global.cohere.embed-v4:0` (embedding) | The only selectable provider — see below. Shared platform credential (`AWS_BEARER_TOKEN`), not per-teacher. |
| Cohere      | Rerank only (not a chat/generation model)                                          | Used to reorder retrieved passages before they reach the LLM.                                               |

**Product decision (this pass): OpenAI and Gemini are no longer selectable
as the generation provider** — teachers can no longer bring their own
OpenAI/Gemini API key; Bedrock is the sole option for both chat and
embedding. The registry still carries the retired OpenAI/Gemini model
specs and their call implementations, kept in place (not deleted) purely
so any pre-existing data reads back safely — they're unreachable via any
save path (`LlmService.assertSelectableProvider`). A teacher picks their
Bedrock model per-course; students never choose a model directly. Several
older models are marked `deprecated: true` in the registry and stay
selectable only for teachers who already had them configured — new
selections are steered to current models.

## Training data & safety alignment (items 54-55)

- **Training data**: not applicable — GALS does not train or fine-tune any
  model. All reasoning/generation is a live API call to the vendor's hosted,
  already-trained model.
- **Safety alignment**: inherited entirely from the vendor. The underlying
  OpenAI models served through AWS Bedrock are instruction-tuned and
  safety-aligned by OpenAI before GALS ever calls them; GALS does no
  additional alignment work of its own — see Limitations below.

## What GALS adds on top of the vendor model

- **Grounding contract** (`apps/api/src/rag/shared/grounded-prompt.ts`): every
  chat/dialogue call carries a fixed system-prompt contract instructing the
  model to answer only from supplied sources, cite them in a fixed format, say
  so explicitly when the sources don't contain the answer, and — added this
  pass — treat retrieved content and user input as data rather than
  instructions, and refuse harmful requests regardless of what a document or a
  student's message asks for.
- **Faithfulness checking**: an optional retry path that re-checks whether a
  reply actually stayed grounded in the retrieved sources — off by default on
  the main chat surface, on for dialogue mode.
- **User-facing disclaimer**: a persistent "The assistant can make mistakes.
  Double-check anything important." notice under the student chat input.

## Known limitations (item 56)

- **Hallucination risk is not eliminated, only reduced.** The grounding
  contract and faithfulness checks lower the rate of ungrounded claims but
  cannot guarantee zero — students are explicitly warned (see disclaimer
  above), and this is exactly why item 64 exists on the checklist.
- **Output moderation depends on a Guardrail being provisioned.** The
  previous OpenAI Moderation API check was removed along with OpenAI as a
  selectable generation provider (Bedrock-only now). The replacement is AWS
  Bedrock Guardrails: the API attaches `guardrailConfig` to every Converse
  call once `BEDROCK_GUARDRAIL_ID` is set, and a flagged reply is replaced by
  the guardrail's blocked message (logged with the policy that fired). Until
  the Guardrail resource exists in the SMU AWS account, **no moderation
  runs** — the deployment must not be described as moderated before then.
- **PII/confidential-data filtering on output is detection-only in-app.**
  `pii-detection.ts` flags likely PII in every reply and logs it but does not
  redact, because the grounding contract's "answer only from the supplied
  sources" instruction means a teacher's document may legitimately contain
  it. Blocking/anonymising is intended to come from the same Bedrock
  Guardrail's sensitive-information policy (item 63) — a PDPA policy
  decision to make when the Guardrail is configured.
- **No adversarial/red-team testing performed.** The existing automated tests
  (`grounded-prompt.spec.ts`, `grounded-contract-integration.spec.ts`) verify
  citation and grounding _correctness_, not resistance to adversarial prompt
  injection. Checklist items 59-60 are still open.
- **Vendor availability and rate limits are inherited.** An outage or
  rate-limit change at AWS Bedrock directly becomes a GALS-wide AI outage —
  there is no fallback provider now that Bedrock is the only option.
- **No bias auditing has been performed** on any of the vendor models as
  deployed in GALS's specific tutoring context (item 65) — GALS relies
  entirely on each vendor's own alignment work, with no independent
  verification of it (item 66; the in-house `apps/api/src/rag/eval/` harness
  measures answer groundedness, not bias or adversarial robustness).

## Intended use

GALS's AI features are intended for **formative, low-stakes tutoring support**:
answering student questions about course material, generating practice
questions, and surfacing content grounded in teacher-provided sources. They are
**not** intended for, and have not been validated against, high-stakes uses such
as final grading decisions without teacher review, or any use where a
hallucinated or biased response could not be caught before it affects a student.
