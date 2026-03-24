-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "RecordingUploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PyfeatJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "recording_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recording_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "recording_segments" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "minio_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "start_wall_time" TIMESTAMPTZ NOT NULL,
    "end_wall_time" TIMESTAMPTZ,
    "duration_ms" INTEGER,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT NOT NULL DEFAULT 'video/webm',
    "segment_index" INTEGER NOT NULL DEFAULT 0,
    "upload_status" "RecordingUploadStatus" NOT NULL DEFAULT 'PENDING',
    "pyfeat_job_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recording_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "recording_consents" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pupil_size_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pupil_size_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pupil_size_logs" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "pupil_diameter" DOUBLE PRECISION NOT NULL,
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pupil_size_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "webgazer_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "calibration_on_new_session" BOOLEAN NOT NULL DEFAULT true,
    "inactivity_timeout_secs" INTEGER NOT NULL DEFAULT 1800,
    "recalibration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webgazer_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "webgazer_logs" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "gaze_x" DOUBLE PRECISION NOT NULL,
    "gaze_y" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "page_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webgazer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "webgazer_calibration_events" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "accuracy" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webgazer_calibration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pyfeat_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "extraction_fps" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "enabled_aus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detector_backend" TEXT NOT NULL DEFAULT 'retinaface',
    "au_predictor" TEXT NOT NULL DEFAULT 'xgb',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pyfeat_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pyfeat_jobs" (
    "id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "status" "PyfeatJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_minio_key" TEXT NOT NULL,
    "result_minio_key" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pyfeat_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pyfeat_au_results" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "frame_index" INTEGER NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "wall_time" TIMESTAMPTZ NOT NULL,
    "au01" DOUBLE PRECISION,
    "au02" DOUBLE PRECISION,
    "au04" DOUBLE PRECISION,
    "au05" DOUBLE PRECISION,
    "au06" DOUBLE PRECISION,
    "au07" DOUBLE PRECISION,
    "au09" DOUBLE PRECISION,
    "au10" DOUBLE PRECISION,
    "au12" DOUBLE PRECISION,
    "au14" DOUBLE PRECISION,
    "au15" DOUBLE PRECISION,
    "au17" DOUBLE PRECISION,
    "au20" DOUBLE PRECISION,
    "au23" DOUBLE PRECISION,
    "au24" DOUBLE PRECISION,
    "au25" DOUBLE PRECISION,
    "au26" DOUBLE PRECISION,
    "au28" DOUBLE PRECISION,
    "face_conf" DOUBLE PRECISION,
    "face_box" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pyfeat_au_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "recording_configs_course_id_key" ON "recording_configs"("course_id");
CREATE INDEX IF NOT EXISTS "recording_segments_student_id_session_id_idx" ON "recording_segments"("student_id", "session_id");
CREATE INDEX IF NOT EXISTS "recording_segments_course_id_idx" ON "recording_segments"("course_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recording_consents_student_id_course_id_key" ON "recording_consents"("student_id", "course_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pupil_size_configs_course_id_key" ON "pupil_size_configs"("course_id");
CREATE INDEX IF NOT EXISTS "pupil_size_logs_student_id_session_id_idx" ON "pupil_size_logs"("student_id", "session_id");
CREATE INDEX IF NOT EXISTS "pupil_size_logs_course_id_idx" ON "pupil_size_logs"("course_id");
CREATE UNIQUE INDEX IF NOT EXISTS "webgazer_configs_course_id_key" ON "webgazer_configs"("course_id");
CREATE INDEX IF NOT EXISTS "webgazer_logs_student_id_session_id_idx" ON "webgazer_logs"("student_id", "session_id");
CREATE INDEX IF NOT EXISTS "webgazer_logs_course_id_idx" ON "webgazer_logs"("course_id");
CREATE INDEX IF NOT EXISTS "webgazer_calibration_events_student_id_course_id_idx" ON "webgazer_calibration_events"("student_id", "course_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pyfeat_configs_course_id_key" ON "pyfeat_configs"("course_id");
CREATE INDEX IF NOT EXISTS "pyfeat_jobs_student_id_course_id_idx" ON "pyfeat_jobs"("student_id", "course_id");
CREATE INDEX IF NOT EXISTS "pyfeat_au_results_job_id_idx" ON "pyfeat_au_results"("job_id");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "recording_configs" ADD CONSTRAINT "recording_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pupil_size_configs" ADD CONSTRAINT "pupil_size_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pupil_size_logs" ADD CONSTRAINT "pupil_size_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pupil_size_logs" ADD CONSTRAINT "pupil_size_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pupil_size_logs" ADD CONSTRAINT "pupil_size_logs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_configs" ADD CONSTRAINT "webgazer_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_logs" ADD CONSTRAINT "webgazer_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_logs" ADD CONSTRAINT "webgazer_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_logs" ADD CONSTRAINT "webgazer_logs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_calibration_events" ADD CONSTRAINT "webgazer_calibration_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_calibration_events" ADD CONSTRAINT "webgazer_calibration_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webgazer_calibration_events" ADD CONSTRAINT "webgazer_calibration_events_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pyfeat_configs" ADD CONSTRAINT "pyfeat_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pyfeat_jobs" ADD CONSTRAINT "pyfeat_jobs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pyfeat_jobs" ADD CONSTRAINT "pyfeat_jobs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pyfeat_jobs" ADD CONSTRAINT "pyfeat_jobs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pyfeat_au_results" ADD CONSTRAINT "pyfeat_au_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "pyfeat_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
