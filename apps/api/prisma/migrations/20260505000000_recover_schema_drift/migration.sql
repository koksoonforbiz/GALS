-- CreateEnum
CREATE TYPE "Openface3JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "recording_configs" ADD COLUMN     "openface3_detector_backend" TEXT NOT NULL DEFAULT 'retinaface',
ADD COLUMN     "openface3_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openface3_extraction_fps" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "openface3_run_on_new_segments" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "cursor_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "elementTarget" TEXT,
    "timestamp" BIGINT NOT NULL,
    "batchId" TEXT,

    CONSTRAINT "cursor_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "elementSelector" TEXT NOT NULL,
    "elementText" TEXT,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "click_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scroll_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scrollY" INTEGER NOT NULL,
    "scrollPercent" DOUBLE PRECISION NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "scroll_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keystroke_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "keystrokeCount" INTEGER NOT NULL,
    "pauseDurationMs" INTEGER NOT NULL,
    "typingSpeedWPM" DOUBLE PRECISION,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "keystroke_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "visibleState" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "hiddenDurationMs" INTEGER,

    CONSTRAINT "visibility_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clipboard_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "textLength" INTEGER NOT NULL,
    "sourceElement" TEXT,
    "pageUrl" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "clipboard_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewport_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "orientation" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "viewport_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "pageLoadMs" INTEGER,
    "apiLatencyMs" INTEGER,
    "resourceTimingsJson" JSONB,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "performance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "stack" TEXT,
    "componentName" TEXT,
    "pageUrl" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "errorType" TEXT,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_sync_anchors" (
    "id" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "wallClockMs" BIGINT NOT NULL,
    "monotonicMs" BIGINT NOT NULL,
    "serverReceiveMs" BIGINT NOT NULL,
    "timezone" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_sync_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modality_offsets" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "offsetMs" INTEGER NOT NULL,
    "estimatedAt" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "modality_offsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_engagement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "windowEndMs" BIGINT NOT NULL,
    "clickRate" DOUBLE PRECISION NOT NULL,
    "scrollActivity" DOUBLE PRECISION NOT NULL,
    "cursorMovement" DOUBLE PRECISION NOT NULL,
    "tabVisibleFraction" DOUBLE PRECISION NOT NULL,
    "engagementScore" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_cognitive_load" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "windowEndMs" BIGINT NOT NULL,
    "avgPupilDiameter" DOUBLE PRECISION NOT NULL,
    "pupilDilation" DOUBLE PRECISION NOT NULL,
    "avgGazeEntropy" DOUBLE PRECISION NOT NULL,
    "avgAU04" DOUBLE PRECISION NOT NULL,
    "avgAU07" DOUBLE PRECISION NOT NULL,
    "cognitiveLoadIndex" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_cognitive_load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_emotion_timeline" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "frameId" TEXT,
    "windowStartMs" BIGINT NOT NULL,
    "emotion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "auEvidence" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_emotion_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_learning_velocity" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kcId" TEXT NOT NULL,
    "masteryStart" DOUBLE PRECISION NOT NULL,
    "masteryEnd" DOUBLE PRECISION NOT NULL,
    "masteryDelta" DOUBLE PRECISION NOT NULL,
    "attemptsCount" INTEGER NOT NULL,
    "durationMs" BIGINT NOT NULL,
    "velocityScore" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_learning_velocity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_at_risk_flags" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flaggedAt" BIGINT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_at_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aligned_frames" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "frameTMs" BIGINT NOT NULL,
    "tRel" BIGINT NOT NULL,
    "segmentId" TEXT,
    "pupilDiameter" DOUBLE PRECISION,
    "gazeX" DOUBLE PRECISION,
    "gazeY" DOUBLE PRECISION,
    "gazeConfidence" DOUBLE PRECISION,
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
    "faceConf" DOUBLE PRECISION,
    "cursorX" INTEGER,
    "cursorY" INTEGER,
    "scrollPercent" DOUBLE PRECISION,
    "interventionType" TEXT,
    "activityAction" TEXT,
    "attemptScore" DOUBLE PRECISION,
    "isTabVisible" BOOLEAN NOT NULL DEFAULT true,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aligned_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ef_detections" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT,
    "constructKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "severity" INTEGER,
    "rationale" TEXT,
    "warning" TEXT,
    "rawJson" JSONB,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "latencyMs" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ef_detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ef_construct_prompts" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "constructKey" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ef_construct_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ef_teacher_settings" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "rolling_window_n" INTEGER NOT NULL DEFAULT 5,
    "detection_concurrency" INTEGER NOT NULL DEFAULT 6,
    "disable_low_feasibility" BOOLEAN NOT NULL DEFAULT false,
    "detection_provider_override" TEXT,
    "detection_model_override" TEXT,
    "pause_ingestion" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ef_teacher_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "openface3_jobs" (
    "id" TEXT NOT NULL,
    "recording_segment_id" TEXT NOT NULL,
    "status" "Openface3JobStatus" NOT NULL DEFAULT 'PENDING',
    "extraction_fps" INTEGER NOT NULL DEFAULT 5,
    "detector_backend" TEXT NOT NULL DEFAULT 'retinaface',
    "frames_processed" INTEGER NOT NULL DEFAULT 0,
    "frames_with_face" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "openface3_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emotion_frames" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "frame_wall_ms" BIGINT NOT NULL,
    "frame_index" INTEGER NOT NULL,
    "face_detected" BOOLEAN NOT NULL,
    "p_happiness" DOUBLE PRECISION,
    "p_sadness" DOUBLE PRECISION,
    "p_surprise" DOUBLE PRECISION,
    "p_fear" DOUBLE PRECISION,
    "p_anger" DOUBLE PRECISION,
    "p_disgust" DOUBLE PRECISION,
    "p_contempt" DOUBLE PRECISION,
    "p_neutral" DOUBLE PRECISION,
    "dominant_emotion" TEXT,
    "dominant_probability" DOUBLE PRECISION,
    "head_pose_yaw" DOUBLE PRECISION,
    "head_pose_pitch" DOUBLE PRECISION,
    "head_pose_roll" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emotion_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affective_mapping_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "window_seconds" INTEGER NOT NULL DEFAULT 30,
    "stride_seconds" INTEGER NOT NULL DEFAULT 10,
    "min_frames_per_window" INTEGER NOT NULL DEFAULT 5,
    "rules" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affective_mapping_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affective_mapping_config_history" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "stride_seconds" INTEGER NOT NULL,
    "min_frames_per_window" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affective_mapping_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affective_state_windows" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "config_version" INTEGER NOT NULL,
    "window_start_wall_ms" BIGINT NOT NULL,
    "window_end_wall_ms" BIGINT NOT NULL,
    "frames_in_window" INTEGER NOT NULL,
    "frames_with_face" INTEGER NOT NULL,
    "engagement" DOUBLE PRECISION NOT NULL,
    "boredom" DOUBLE PRECISION NOT NULL,
    "confusion" DOUBLE PRECISION NOT NULL,
    "frustration" DOUBLE PRECISION NOT NULL,
    "dominant_state" TEXT NOT NULL,
    "mean_happiness" DOUBLE PRECISION,
    "mean_sadness" DOUBLE PRECISION,
    "mean_surprise" DOUBLE PRECISION,
    "mean_fear" DOUBLE PRECISION,
    "mean_anger" DOUBLE PRECISION,
    "mean_disgust" DOUBLE PRECISION,
    "mean_contempt" DOUBLE PRECISION,
    "mean_neutral" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affective_state_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cursor_logs_sessionId_timestamp_idx" ON "cursor_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "click_logs_sessionId_timestamp_idx" ON "click_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "scroll_logs_sessionId_timestamp_idx" ON "scroll_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "keystroke_logs_sessionId_timestamp_idx" ON "keystroke_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "visibility_logs_sessionId_timestamp_idx" ON "visibility_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "clipboard_logs_sessionId_timestamp_idx" ON "clipboard_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "viewport_logs_sessionId_timestamp_idx" ON "viewport_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "performance_logs_sessionId_timestamp_idx" ON "performance_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "error_logs_sessionId_timestamp_idx" ON "error_logs"("sessionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "session_sync_anchors_sessionId_key" ON "session_sync_anchors"("sessionId");

-- CreateIndex
CREATE INDEX "modality_offsets_sessionId_modality_idx" ON "modality_offsets"("sessionId", "modality");

-- CreateIndex
CREATE INDEX "derived_engagement_sessionId_idx" ON "derived_engagement"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "derived_engagement_sessionId_windowStartMs_key" ON "derived_engagement"("sessionId", "windowStartMs");

-- CreateIndex
CREATE INDEX "derived_cognitive_load_sessionId_idx" ON "derived_cognitive_load"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "derived_cognitive_load_sessionId_windowStartMs_key" ON "derived_cognitive_load"("sessionId", "windowStartMs");

-- CreateIndex
CREATE INDEX "derived_emotion_timeline_sessionId_windowStartMs_idx" ON "derived_emotion_timeline"("sessionId", "windowStartMs");

-- CreateIndex
CREATE INDEX "derived_learning_velocity_sessionId_kcId_idx" ON "derived_learning_velocity"("sessionId", "kcId");

-- CreateIndex
CREATE INDEX "derived_at_risk_flags_sessionId_idx" ON "derived_at_risk_flags"("sessionId");

-- CreateIndex
CREATE INDEX "aligned_frames_sessionId_frameTMs_idx" ON "aligned_frames"("sessionId", "frameTMs");

-- CreateIndex
CREATE UNIQUE INDEX "aligned_frames_sessionId_frameId_key" ON "aligned_frames"("sessionId", "frameId");

-- CreateIndex
CREATE INDEX "ef_detections_sessionId_constructKey_created_at_idx" ON "ef_detections"("sessionId", "constructKey", "created_at");

-- CreateIndex
CREATE INDEX "ef_detections_studentId_constructKey_created_at_idx" ON "ef_detections"("studentId", "constructKey", "created_at");

-- CreateIndex
CREATE INDEX "ef_detections_messageId_idx" ON "ef_detections"("messageId");

-- CreateIndex
CREATE INDEX "ef_construct_prompts_courseId_constructKey_idx" ON "ef_construct_prompts"("courseId", "constructKey");

-- CreateIndex
CREATE UNIQUE INDEX "ef_construct_prompts_courseId_constructKey_version_key" ON "ef_construct_prompts"("courseId", "constructKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ef_teacher_settings_teacher_id_key" ON "ef_teacher_settings"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "openface3_jobs_recording_segment_id_key" ON "openface3_jobs"("recording_segment_id");

-- CreateIndex
CREATE INDEX "openface3_jobs_status_idx" ON "openface3_jobs"("status");

-- CreateIndex
CREATE INDEX "openface3_jobs_recording_segment_id_idx" ON "openface3_jobs"("recording_segment_id");

-- CreateIndex
CREATE INDEX "emotion_frames_session_id_frame_wall_ms_idx" ON "emotion_frames"("session_id", "frame_wall_ms");

-- CreateIndex
CREATE INDEX "emotion_frames_user_id_frame_wall_ms_idx" ON "emotion_frames"("user_id", "frame_wall_ms");

-- CreateIndex
CREATE INDEX "emotion_frames_course_id_frame_wall_ms_idx" ON "emotion_frames"("course_id", "frame_wall_ms");

-- CreateIndex
CREATE INDEX "emotion_frames_job_id_idx" ON "emotion_frames"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "affective_mapping_configs_course_id_key" ON "affective_mapping_configs"("course_id");

-- CreateIndex
CREATE INDEX "affective_mapping_config_history_config_id_idx" ON "affective_mapping_config_history"("config_id");

-- CreateIndex
CREATE UNIQUE INDEX "affective_mapping_config_history_config_id_version_key" ON "affective_mapping_config_history"("config_id", "version");

-- CreateIndex
CREATE INDEX "affective_state_windows_session_id_window_start_wall_ms_idx" ON "affective_state_windows"("session_id", "window_start_wall_ms");

-- CreateIndex
CREATE INDEX "affective_state_windows_user_id_course_id_window_start_wall_idx" ON "affective_state_windows"("user_id", "course_id", "window_start_wall_ms");

-- CreateIndex
CREATE INDEX "affective_state_windows_course_id_window_start_wall_ms_idx" ON "affective_state_windows"("course_id", "window_start_wall_ms");

-- CreateIndex
CREATE UNIQUE INDEX "affective_state_windows_session_id_window_start_wall_ms_con_key" ON "affective_state_windows"("session_id", "window_start_wall_ms", "config_version");

-- AddForeignKey
ALTER TABLE "session_sync_anchors" ADD CONSTRAINT "session_sync_anchors_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "student_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openface3_jobs" ADD CONSTRAINT "openface3_jobs_recording_segment_id_fkey" FOREIGN KEY ("recording_segment_id") REFERENCES "recording_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emotion_frames" ADD CONSTRAINT "emotion_frames_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "openface3_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affective_mapping_configs" ADD CONSTRAINT "affective_mapping_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affective_mapping_config_history" ADD CONSTRAINT "affective_mapping_config_history_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "affective_mapping_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affective_state_windows" ADD CONSTRAINT "affective_state_windows_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "affective_mapping_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

