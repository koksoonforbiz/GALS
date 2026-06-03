-- Floating / docked chatbot persistent history.
-- Mirrors dialogue_messages shape (role/content/tokens) but anchored
-- on student_sessions directly. ON DELETE CASCADE so chat history is
-- purged with its session.
CREATE TABLE "chatbot_messages" (
    "id" UUID NOT NULL,
    "student_session_id" UUID NOT NULL,
    "course_id" UUID,
    "module_item_id" UUID,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "context_source" TEXT,
    "selected_text" TEXT,
    "suggested_strategy" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "model" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatbot_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chatbot_messages_student_session_id_idx" ON "chatbot_messages"("student_session_id");
CREATE INDEX "chatbot_messages_student_session_id_created_at_idx" ON "chatbot_messages"("student_session_id", "created_at");

ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_student_session_id_fkey"
    FOREIGN KEY ("student_session_id") REFERENCES "student_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
