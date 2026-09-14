# Backup Plan

Satisfies SMU Cybersecurity Checklist item 28 ("detailed plan how to backup
data and system, with the backup frequency according to research risk
tolerance"). This is the **plan**; items 29–31 (an actual off-site backup
existing, restore testing, and confirmed retention) are execution against
this plan and stay pending until the L40 server exists — see
`docs/PRODUCTION_DEPLOYMENT_TODO.md` §2/§4. Drafted directly from the schema
and stack in this repo, not a generic template.

## What needs backing up, and why each is treated differently

| Store                                                                                               | What's in it                                                                                                                                           | Backup approach                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**                                                                                      | Every table: accounts, courses, attempts, chat transcripts, activity logs, security events — the entire application's source of truth except raw media | Full logical dump (`pg_dump`), daily                                                                | Small enough (no video/audio) for a full daily dump to be cheap; this is the data whose loss would be most damaging (it's the actual research data)                                                                                                                                                                                                                                                                                                                                |
| **MinIO / object storage**                                                                          | Webcam/screen recording segments, uploaded course documents, exported activity-log bundles                                                             | Bucket sync/replication to a second location, daily                                                 | Large binary data — a full dump-style backup doesn't fit; incremental sync (only changed/new objects) is the right tool for this shape of data                                                                                                                                                                                                                                                                                                                                     |
| **Redis**                                                                                           | Session cache, rate-limit/lockout counters, ephemeral 2FA/TOTP-setup challenge state                                                                   | **Not backed up**                                                                                   | Everything in it is intentionally short-lived (see each service's own TTLs — e.g. `LoginProtectionService`, `TotpService` setup state). Losing it on restore just means active sessions re-authenticate and in-flight 2FA challenges restart; no data is lost because none of it is data of record                                                                                                                                                                                 |
| **Application secrets** (`.env`: `JWT_SECRET`, `ENCRYPTION_KEY`, DB/SMTP credentials, LLM API keys) | Configuration, not research data                                                                                                                       | Kept in a password manager / secrets vault outside this repo, **not** part of the data-backup cycle | These aren't "data" in the checklist's sense — losing the running `.env` is a redeployment problem, not a data-loss one. Note: if `ENCRYPTION_KEY` is ever lost with no backup copy anywhere, every AES-256-GCM-encrypted TOTP secret and LLM API key in the database becomes permanently unrecoverable (not just the current session) — this is the one secret whose backup genuinely matters and should be treated as a first-class backup item, not left solely to redeployment |

## Frequency (item 28)

Given this is a research/teaching platform (not a financial or
life-safety system), risk tolerance favors **daily** granularity over
continuous/point-in-time replication — a day of lost work is recoverable
without meaningfully harming the study, and daily keeps the backup
infrastructure simple enough to actually run and verify reliably:

- **PostgreSQL**: full logical dump once daily, off-peak.
- **MinIO**: incremental sync once daily, off-peak, after the DB dump
  completes (so a given day's backup is internally consistent — recordings
  referenced by that day's DB snapshot are guaranteed to have already synced).

## Retention (item 31)

Proposed tiered retention, chosen to match the checklist's own worked
example (twelve (12) weeks) without keeping unbounded history:

- **Daily backups**: kept 4 weeks (28 days) — covers "I need last Tuesday's
  state" without a formal request.
- **Weekly backups** (one of the 7 daily dumps, promoted): kept 12 weeks —
  the checklist's example retention window, giving a full-quarter recovery
  point.

This is a proposal, not yet confirmed against actual storage capacity or a
formal risk-tolerance sign-off from the research team — flagged here rather
than presented as already-agreed. **Backup retention (this section) is a
different question from data retention** (how long the live application
keeps a record before deleting it, tracked separately and still pending
legal input — see `docs/DATA_INVENTORY.md` item 37): a backup can and should
still be purged as scheduled above even for data whose live retention
period is much longer.

## Off-site location (item 29)

Not yet decided — genuinely depends on the L40 server's actual deployment
environment (a second physical site? a cloud storage bucket used purely as
a backup target, distinct from the primary MinIO/S3 store? SMU-provided
infrastructure?), none of which exists yet. This is the one part of the
plan that can't be finalized from the codebase alone.

## Restore testing (item 30)

Per the checklist's own requirement: test the full restore procedure
(Postgres dump → fresh instance, MinIO sync → fresh bucket) once before
go-live, and at least annually afterward. Cannot be evidenced before a live
system exists to restore onto — tracked as a go-live gate in
`docs/PRODUCTION_DEPLOYMENT_TODO.md`.

## Who runs this

Not yet assigned — the same open question as the rest of operational
ownership once the L40 server exists (who has SSH/console access, who's on
call). Noted here so it isn't silently assumed.
