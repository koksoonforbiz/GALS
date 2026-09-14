# Bill of Materials

Satisfies SMU Cybersecurity Checklist item 45 ("bill of materials provided").

This is a software BOM for GALS's production dependency tree — every package that
ships in a running `api` or `web` container, transitively included. Dev-only tooling
(test runners, linters, bundlers) is excluded since it never runs in production.

## Regenerating

```
pnpm bom
```

This runs `pnpm licenses list --json --prod` against the current lockfile and
rewrites [`docs/bom.csv`](./bom.csv). Regenerate it whenever dependencies change
materially, and before handing a copy to IITS.

## Summary (as of 2026-09-08)

- **953 production packages**, resolved from `pnpm-lock.yaml`.
- **License mix**: overwhelmingly permissive — 728 MIT, 130 Apache-2.0, 43 ISC, 17
  BSD-2-Clause, 15 BSD-3-Clause, plus a long tail of single-digit-count licenses.
  No GPL/AGPL/LGPL copyleft license appears as a sole license on any package.
- **Worth a specific look**:
  - `jszip@3.10.1` is dual-licensed `MIT OR GPL-3.0-or-later` — GALS uses it under
    the MIT option, so no copyleft obligation attaches.
  - `pause@0.0.1` and `thirty-two@1.0.2` report an unrecognized/unknown license
    field (no copyleft language in either package; `thirty-two` is a small base32
    codec pulled in transitively by the TOTP library).
  - Everything else outside the top five licenses is public-domain-equivalent
    (`CC0-1.0`, `MIT-0`, `0BSD`) or a Creative Commons attribution license on
    non-code assets (`caniuse-lite`'s data tables, `spdx-exceptions`' license text).

## Full listing

See [`docs/bom.csv`](./bom.csv) — one row per package: name, resolved version(s),
license, and upstream homepage. Open it in a spreadsheet tool for filtering/sorting.

## Business purpose, classification, and approval (item 24)

`docs/ARCHITECTURE.md`'s asset inventory table covers these 3 fields
per-asset for the 7 infrastructure components (databases, runtimes, etc.);
doing the same per-row for 953 individual npm packages isn't practical, so
this BOM is covered by one blanket statement instead:

- **Business purpose**: every package here is a transitive or direct
  dependency of the `api` or `web` production build — application
  functionality, not tooling (dev-only packages are already excluded, see
  above). There is no discretionary/non-essential package in this list.
- **Classification**: Internal — Operational Dependency. None of these
  packages independently store or process personal data outside of what the
  application code built on top of them does (that data-handling is
  inventoried separately in `docs/DATA_INVENTORY.md`).
- **Approval/authorised date**: there is no formal per-package
  approval workflow (same gap noted under item 34) — a new dependency is
  added via a normal code-review-gated pull request, and `pnpm-lock.yaml`'s
  git history is the closest available record of when each package version
  entered the tree. `git log --follow -- pnpm-lock.yaml` gives that history
  if a specific package's introduction date is ever needed.

## Vulnerability status

Dependency vulnerabilities are tracked separately via `pnpm audit --prod`, not
duplicated here — see the "GALS Checklist Audit" report (checklist item 51) for
the current count and remediation status. As of this BOM's generation date: 0
critical, 3 high, 7 moderate findings remain, all requiring either a major-version
framework migration (NestJS v10→v11, React Router v6→v7) with dedicated testing,
or affecting only a disabled/unused native build step — see that report for detail.
