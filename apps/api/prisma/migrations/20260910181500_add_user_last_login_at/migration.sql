-- Checklist item 13 — quarterly account review needs a per-role login
-- recency signal (students already have one via ActivityLog/StudentSession;
-- teachers/admins had none). Set on every successful login.
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMPTZ;
