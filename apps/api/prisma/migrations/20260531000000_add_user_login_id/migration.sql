-- Teacher bulk user provisioning (prompt 02).
--
-- Adds an optional, unique `login_id` column to the `users` table so a
-- teacher can hand out a human-friendly login handle alongside the
-- email. The auth layer accepts either the email or the loginId as the
-- identifier; loginId is never used as a foreign key — every log /
-- session / enrollment row still references the `users.id` UUID. So
-- adding loginId does not change any traceability path.
--
-- Additive + nullable so existing rows stay valid without backfill.

ALTER TABLE "users"
  ADD COLUMN "login_id" TEXT;

CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");
