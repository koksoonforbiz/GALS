-- Add CHATBOT_MESSAGE_SENT and CHATBOT_MESSAGE_RECEIVED to the
-- ActivityAction enum so the floating chatbot's activity_log batch
-- inserts no longer fail silently in Prisma's enum validator.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CHATBOT_MESSAGE_SENT';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CHATBOT_MESSAGE_RECEIVED';
