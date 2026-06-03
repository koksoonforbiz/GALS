-- Add PRACTICE_TEST_CONFIGURED to the ActivityAction enum so the
-- practice-testing intervention can record a distinct event capturing
-- the student's chosen mcq/short counts + coverage narrowing before the
-- generation kicks off. Emitted alongside (not in place of) the
-- existing INTERVENTION_TRIGGERED so dashboards keep working.
--
-- Postgres requires `ALTER TYPE ... ADD VALUE` to run in its own
-- transaction; IF NOT EXISTS makes it idempotent if applied twice.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PRACTICE_TEST_CONFIGURED';
