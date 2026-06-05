-- Add eye_tracker_type to webgazer_configs
-- Defaults to 'webgazer' so all existing configs keep current behaviour.
ALTER TABLE "webgazer_configs" ADD COLUMN "eye_tracker_type" TEXT NOT NULL DEFAULT 'webgazer';
