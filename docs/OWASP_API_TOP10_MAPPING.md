# OWASP API Security Top 10 (2023) — Mapping

Satisfies SMU Cybersecurity Checklist item 15 ("evidence that API security
best practices are followed, e.g. OWASP API Security Top 10"). Earlier
audits in this project confirmed individual practices exist (validation,
RBAC, rate limiting) without checking them off against each of the
standard's 10 specific categories — this document does that, one by one,
against the actual code, not a generic checklist. Where a real gap was
found, it's either fixed inline (noted below) or left open with an honest
call-out — this is not written to make every row say "Comply."

## API1:2023 — Broken Object Level Authorization

**Verdict: Strong, with one documented architectural trade-off.**

Every resource-scoped route either checks `@Roles()` at the route level
(`RolesGuard`) or enforces ownership at the service layer — e.g.
`CoursesService.update`/`.publish`/`.remove` all verify
`course.teacherId === callerId` before acting, `UserManagementService`
scopes teacher actions to students enrolled in the teacher's own courses.
`docs/USER_ACCESS_MATRIX.md` documents 66 routes that rely on this
service-layer ownership check rather than a route-level role guard alone —
flagged there explicitly as a distinct authorization pattern rather than
silently mixed in with the route-level table, so it's auditable as its own
category.

**Correction (two-door Phase 0 audit, fixed in Phase 4):** the earlier
claim that "no route was found that takes a foreign resource id without
checking who owns it" was wrong for two routes.
`GET /api/pupil-size/logs/:studentId/:sessionId/export` and
`GET /api/webgazer/logs/:studentId/:sessionId/export` had `RolesGuard`
from their controller class but no `@Roles()` — and `RolesGuard` passes
any authenticated user when no roles are required — so any logged-in
student could export another student's gaze/pupil CSV by supplying ids.
Both now carry `@Roles('teacher')` like their sibling log-read routes
(`docs/two-door/api-classification.md`, "★ Finding"). The same audit
also found the three Socket.IO gateways accepted unauthenticated
connections and unverified room joins; they now authenticate the
handshake JWT and check room ownership (`apps/api/src/auth/ws-auth.service.ts`).

## API2:2023 — Broken Authentication

**Verdict: Strong.** This is the most heavily audited area of this
project this session: bcrypt password hashing (cost 10), a real password
complexity policy (item 3), 5-attempt account lockout (item 5), MFA via
TOTP or email-OTP, JWT sessions re-validated against `User.isActive` on
_every_ request (not just at token issue — `JwtStrategy.validate`), account
deactivation takes effect immediately rather than at next login, and —
added this pass — self-service password change with a 180-day expiry, a
3-day minimum age, and reuse prevention against the last 3 passwords
(`apps/api/src/auth/`). No endpoint accepts a client-asserted user id in
place of the JWT-derived one.

## API3:2023 — Broken Object Property Level Authorization

**Verdict: Gap found and fixed this pass.** `PATCH /courses/:id`
(`courses.controller.ts`) accepted `UpdateCourse & Record<string,
unknown>` with **no validation pipe**, passed straight into a raw
`data: dto` Prisma update (`CoursesService.update`). The route's ownership
check only verifies the _caller_ owns the course before the write — it did
nothing to stop that owner from also setting `teacherId` (reassigning the
course to a different account), or `status`/`visibility`/`archivedAt`,
fields that have their own dedicated, more carefully gated endpoints
(`/publish`, `/unpublish`). This is the textbook API3 pattern: correct
object-level check, missing property-level whitelist.

**Fixed**: the route now runs the body through
`ZodValidationPipe(UpdateCourseSchema)`, whitelisting exactly the fields
the route is meant to update (`title`, `description`, `learningMode`,
`dblSettings`, `allowStudentSelfEnroll`, `allowStudentSelfDrop`) — anything
else is silently stripped before it reaches Prisma. Regression test:
`apps/api/src/courses/courses.update-mass-assignment.spec.ts`.

A full sweep of the other 65 service-layer-authorized routes for the same
pattern (loose body typing + no validation pipe) was **not** done this
pass — this fix closes the one instance actually found via the tell-tale
`& Record<string, unknown>` signature (confirmed to be the only occurrence
of that exact pattern via `grep`), not a claim that every route was
individually re-audited.

## API4:2023 — Unrestricted Resource Consumption

**Verdict: Strong.** Global rate limiting (`ThrottlerGuard`, bound via
`APP_GUARD` — a real gap found and fixed earlier this project, since the
guard existed but was never actually bound) plus tighter per-route limits
on expensive operations (AI generation, bulk provisioning, file uploads,
exports). Request body size is capped (12 MB, enforced identically for
both plain and gzip-decompressed payloads — see `main.ts`'s
`GZIP_BODY_LIMIT_BYTES` comment, which specifically defends against a
zip-bomb-style small-compressed/huge-decompressed payload). Upload size is
separately bounded per course (`maxFileSizeMb`, `maxFilesPerStudent`,
checked server-side in `DialogueCourseSettingsSchema`). AI usage has an
additional cost-based ceiling beyond request-frequency limiting —
`LlmUsageQuotaService`'s per-key-owner daily USD spend cap (item 16),
which a pure per-minute throttle wouldn't catch (a slow, sustained heavy
user could otherwise run up an unbounded bill over hours without ever
tripping a rate limit).

## API5:2023 — Broken Function Level Authorization

**Verdict: Strong.** `@Roles()` + `RolesGuard` gate every
administrative/teacher function; `docs/USER_ACCESS_MATRIX.md` is the
complete, code-derived matrix. The new checklist-item-5 password-lifecycle
gate is itself a function-level control worth noting here: `RolesGuard`
now also blocks _every_ function on an account with an outstanding forced
password change, regardless of role, until it's resolved via the one
route deliberately exempted (`POST /auth/change-password`).

## API6:2023 — Unrestricted Access to Sensitive Business Flows

**Verdict: Partial — rate-limited, not behaviorally gated.** The
standard's concern here is automated abuse of a _legitimate_ business
flow (bulk account creation, scripted enrollment) rather than a broken
access-control bug. Bulk user provisioning and bulk enrollment are
rate-limited (5 calls/min) and capped at 500/1000 rows per call, which
raises the cost of abuse but isn't the CAPTCHA-or-behavioral-analysis-style
defense the standard describes for anonymous-abuse scenarios. Marked
Partial rather than Comply because every sensitive flow here already
requires teacher/admin authentication — the _anonymous_ abuse case (e.g. a
bot scripting public self-registration) has only the existing per-IP
throttle on `/auth/register` (5/min) as its defense, which is a real but
minimal deterrent, not the richer mitigation the standard envisions.

## API7:2023 — Server Side Request Forgery (SSRF)

**Verdict: Not applicable — no attacker-controlled URL fetch exists.**
Checked every outbound HTTP call in the codebase (`fetch(`/`axios`/
`http.request` across `apps/api/src`): all three call sites
(`llm.service.ts`, `embedding.service.ts`,
`rag/reranker/cohere-reranker.service.ts`) target a hardcoded, fixed
third-party API endpoint (OpenAI, Google, AWS Bedrock, Cohere) selected
from a small server-side allowlist — none accept or construct a URL from
user input. There is no "import from URL," webhook-registration, or
avatar-from-URL feature anywhere in the product that would give a caller
control over an outbound request's destination.

## API8:2023 — Security Misconfiguration

**Verdict: Strong, for the layers that live in the codebase.**
Helmet.js for baseline HTTP security headers; CORS restricted to an
explicit, environment-configured origin allowlist (`ALLOWED_ORIGINS`), not
a wildcard; Swagger/OpenAPI docs disabled outside non-production
environments (`main.ts`); production Docker stages for `apps/api` and
`apps/web` run as a non-root user; the `GlobalExceptionFilter` returns a
generic message for unhandled exceptions rather than leaking a stack
trace. What's explicitly **not** covered here (tracked separately, items
32/33/48/50): TLS termination, disk encryption, host-level anti-malware
and OS/CIS hardening — these need the L40 server to exist first, so this
category is scoped to what's actually in the application layer.

## API9:2023 — Improper Inventory Management

**Verdict: Strong.** `docs/BOM.md`/`docs/bom.csv` (953 production
packages), `docs/ARCHITECTURE.md`'s infrastructure asset table (both
extended this session to cover business purpose, classification, and
approval date — item 24), and `docs/USER_ACCESS_MATRIX.md`'s full
340-route inventory together cover both the "what software are we
running" and "what API surface exists" halves of this category. Swagger
docs (item 14) additionally give a live, auto-generated view of the actual
API surface rather than a hand-maintained document that can drift from
the code.

## API10:2023 — Unsafe Consumption of APIs

**Verdict: Partial.** Every third-party API response (OpenAI, Gemini,
Bedrock, Cohere) is wrapped in a try/catch with a checked `response.ok`
before parsing, and a non-2xx or malformed response degrades gracefully
(e.g. `moderateText` treats a moderation-API error as "not flagged" rather
than propagating a crash; `callGeminiApi` reads `promptFeedback`/
`finishReason` defensively with optional chaining throughout). What's
**not** done: response bodies from these providers aren't validated
against a strict schema before use (e.g. a provider returning an
unexpected shape is handled by optional-chaining-into-`undefined` rather
than a schema-validation error with a clear message) — functionally safe
against a crash, but not the schema-validated consumption the standard
describes. Marked Partial rather than Comply for that reason.

## Summary

| #     | Category                                        | Verdict                                |
| ----- | ----------------------------------------------- | -------------------------------------- |
| API1  | Broken Object Level Authorization               | Strong                                 |
| API2  | Broken Authentication                           | Strong                                 |
| API3  | Broken Object Property Level Authorization      | Gap found & fixed this pass            |
| API4  | Unrestricted Resource Consumption               | Strong                                 |
| API5  | Broken Function Level Authorization             | Strong                                 |
| API6  | Unrestricted Access to Sensitive Business Flows | Partial                                |
| API7  | Server Side Request Forgery                     | N/A — no attacker-controlled URL fetch |
| API8  | Security Misconfiguration                       | Strong (application layer)             |
| API9  | Improper Inventory Management                   | Strong                                 |
| API10 | Unsafe Consumption of APIs                      | Partial                                |

6 Strong, 2 Partial, 1 N/A, 1 real gap found and closed during this review
(API3 — see `courses.controller.ts` / `courses.update-mass-assignment.spec.ts`).
