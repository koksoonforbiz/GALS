-- Checklist item 62 — output moderation flags (OpenAI Moderation API or
-- Gemini's own safety filter) previously only reached Logger.warn output.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'AI_OUTPUT_FLAGGED';
