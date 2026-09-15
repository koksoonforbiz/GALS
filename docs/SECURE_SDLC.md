# Secure Development Lifecycle

Satisfies SMU Cybersecurity Checklist item 20 ("secure SDLC aligned to OWASP for
web applications"). This documents practices **already in place** in this
codebase — it's a description of reality, not a new process being introduced.
Where a practice is aspirational rather than actual, it's marked as such.

## Input validation (OWASP A03/A04 — injection, insecure design)

Every API route that accepts a request body validates it against a Zod schema
before the handler runs, via `ZodValidationPipe`
(`apps/api/src/common/zod-validation.pipe.ts`). Schemas live in
`packages/shared/src` so the same validation rules are also available to the
frontend for early feedback. This is enforced as a matter of habit rather than
a global framework guard — the checklist audit's item 15 review is the
mechanism that catches drift (see the audit's history of finding and fixing
unvalidated endpoints in `dialogue.controller.ts` and `recording.controller.ts`).

## Authentication & authorization (OWASP A01, A07)

- JWT bearer auth (`JwtAuthGuard`) + role-based access control (`RolesGuard`,
  `@Roles()`) on every controller — see item 7 in the checklist audit for the
  RBAC coverage review.
- Every permission denial is now written to a queryable audit table
  (`SecurityEvent`, checklist item 25), not just application logs — added
  specifically so a future code-review pass or incident investigation has a
  database to query instead of grepping container logs.
- Password hashing: bcrypt, cost 10. Complexity requirements enforced via
  shared Zod schema (`PASSWORD_COMPLEXITY` in `packages/shared/src/user.ts`).
- Secrets (TOTP, per-teacher LLM API keys) are AES-256-GCM encrypted at rest.
  Every encryption key derivation fails loudly (`ConfigService.getOrThrow`)
  rather than falling back to a public default string if `JWT_SECRET` is
  missing — this was found to have two separate implementations during this
  project (`llm.service.ts`, `embedding.service.ts`) and both are now
  consistent.

## Injection defense (OWASP A03)

- SQL: Prisma's parameterized query builder throughout — no raw string-built
  SQL in application code.
- Shell/command: `execFile()` (not `exec()`) for the one place this codebase
  shells out to another process (`jobs.controller.ts`'s session export),
  plus UUID validation on the identifier before it ever reaches that call.
- Prompt injection (AI-specific, checklist items 57-59): every grounded LLM
  call goes through one shared contract (`GROUNDING_CONTRACT` in
  `rag/shared/grounded-prompt.ts`) that treats retrieved documents and user
  input as data, never instructions — regression-tested against 8 known
  jailbreak/injection payloads in `grounded-prompt.injection.spec.ts`.

## Dependency management (OWASP A06 — vulnerable components)

- `pnpm audit --prod` runs in CI on every push/PR (`dependency-audit` job
  in `.github/workflows/ci.yml`) and fails the pipeline on any high or
  critical advisory; Dependabot (`.github/dependabot.yml`) opens PRs for
  npm, pip (the three Python workers), Docker base images and GitHub
  Actions weekly and for security advisories as they land. `pnpm.overrides`
  in the root `package.json` pins every patchable finding to a fixed,
  same-major version — each override documents which advisory it closes.
  Remaining known findings (moderate only) are tracked in
  `docs/PRODUCTION_DEPLOYMENT_TODO.md` §5.
- `docs/BOM.md` / `docs/bom.csv` — regenerable software bill of materials
  (`pnpm bom`), checklist item 45.

## Testing

- Unit tests run via `pnpm test` / Jest; the API suite currently sits at
  300+ passing tests covering auth, RBAC, the grounding contract, malware
  scanning, PII detection, and the security-event audit trail added this
  pass — all listed here because they're the parts of the SDLC this document
  is about, not a general test-coverage claim.
- Integration tests (`*.integration.spec.ts`) exercise real HTTP routes
  against a Postgres/Redis-backed NestJS app instance.
- No dedicated security/penetration test suite beyond the prompt-injection
  regression tests above — checklist items 51-52 (formal vulnerability
  remediation SLAs, annual pen testing) are process commitments with IITS,
  not something this repo's test suite substitutes for.

## Code review

Enforced via `.husky` pre-commit hooks (`lint-staged`: ESLint + Prettier on
every staged file) — not a substitute for human review, but it does mean
nothing with a lint _error_ (as opposed to warning) reaches a commit.
Human PR review process itself is a team/process practice, not something
observable from the repository alone.

## What's NOT yet true (be honest about the gap)

- **No SAST/DAST tool wired into CI** (checklist item 20) — the checklist
  specifies this is IITS-provided; the CI-gated `pnpm audit` above covers
  dependency advisories only, not static/dynamic analysis of our own code.
- **No formal secure-coding training or SDLC sign-off process** — this
  document itself is the first formalization of "what do we actually do,"
  written retroactively rather than as an upfront policy.
- **No staging environment with a security gate before production** — the
  Docker Compose setup here is dev-only; a real staging/production pipeline
  doesn't exist yet in this repo (depends on IITS's hosting decision).

## How to keep this current

This document decays if practices change without updating it — same caveat
as `docs/ARCHITECTURE.md` and `docs/BOM.md`. When a new validation pattern,
guard, or dependency-scanning step is added, update the relevant section here
in the same change.
