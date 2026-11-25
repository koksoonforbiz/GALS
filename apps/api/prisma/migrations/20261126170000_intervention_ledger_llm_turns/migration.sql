-- Prompt B, P5: intervention ledger (additive only).
CREATE TABLE IF NOT EXISTS "intervention_ledger" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" UUID,
    "user_id" UUID NOT NULL,
    "course_id" UUID,
    "module_item_id" UUID,
    "initiator" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "intervention_type" TEXT,
    "intervention_id" TEXT,
    "rule_id" TEXT,
    "policy_id" TEXT,
    "arm" TEXT,
    CONSTRAINT "intervention_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "intervention_ledger_session_id_idx" ON "intervention_ledger"("session_id");
CREATE INDEX IF NOT EXISTS "intervention_ledger_user_id_created_at_idx" ON "intervention_ledger"("user_id", "created_at");

-- LLM-turn record (Prompt B, P5 / R12).
CREATE TABLE IF NOT EXISTS "llm_turns" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" UUID,
    "user_id" UUID NOT NULL,
    "course_id" UUID,
    "module_item_id" UUID,
    "channel" TEXT NOT NULL,
    "request_message_id" UUID NOT NULL,
    "selection_source" TEXT NOT NULL,
    "selection_len" INTEGER NOT NULL,
    "context_source" TEXT NOT NULL,
    "current_page" INTEGER,
    "page_type" TEXT,
    "attempt_before" BOOLEAN NOT NULL,
    "time_since_last_error_s" INTEGER,
    "follow_up" BOOLEAN NOT NULL,
    "model" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "response_role" TEXT NOT NULL,
    "guardrail_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "suggested_strategy" TEXT,
    "intent_label" TEXT,
    CONSTRAINT "llm_turns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "llm_turns_session_id_idx" ON "llm_turns"("session_id");
CREATE INDEX IF NOT EXISTS "llm_turns_user_id_created_at_idx" ON "llm_turns"("user_id", "created_at");
