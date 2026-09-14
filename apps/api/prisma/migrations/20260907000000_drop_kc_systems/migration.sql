-- AlterEnum
BEGIN;
CREATE TYPE "ActivityAction_new" AS ENUM ('SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT', 'MODULE_OPENED', 'MODULE_ITEM_VIEWED', 'ASSESSMENT_STARTED', 'QUESTION_VIEWED', 'QUESTION_ANSWERED', 'ASSESSMENT_SUBMITTED', 'ASSESSMENT_GRADED', 'DIALOGUE_SESSION_STARTED', 'DIALOGUE_MESSAGE_SENT', 'DIALOGUE_MESSAGE_RECEIVED', 'DIALOGUE_SESSION_ENDED', 'CHATBOT_MESSAGE_SENT', 'CHATBOT_MESSAGE_RECEIVED', 'INTERVENTION_TRIGGERED', 'INTERVENTION_VIEWED', 'INTERVENTION_COMPLETED', 'INTERVENTION_DISMISSED', 'PRACTICE_TEST_CONFIGURED', 'SPACED_REP_CARD_VIEWED', 'SPACED_REP_CARD_RATED', 'STUDY_MATERIAL_UPLOADED', 'STUDY_GUIDE_GENERATED', 'STUDIO_OUTPUT_REQUESTED', 'STUDIO_OUTPUT_VIEWED', 'FEEDBACK_RECEIVED', 'RECORDING_STARTED', 'RECORDING_STOPPED', 'RECORDING_SEGMENT_UPLOADED', 'RECORDING_UPLOAD_FAILED', 'RECORDING_RESUMED', 'PUPIL_SIZE_TRACKING_STARTED', 'PUPIL_SIZE_TRACKING_STOPPED', 'PUPIL_SIZE_BATCH_SUBMITTED', 'WEBGAZER_TRACKING_STARTED', 'WEBGAZER_TRACKING_STOPPED', 'WEBGAZER_CALIBRATION_STARTED', 'WEBGAZER_CALIBRATION_COMPLETED', 'WEBGAZER_CALIBRATION_SKIPPED', 'WEBGAZER_BATCH_SUBMITTED', 'WEBGAZER_RECALIBRATION_PROMPTED', 'PYFEAT_JOB_ENQUEUED', 'PYFEAT_JOB_COMPLETED', 'PYFEAT_JOB_FAILED', 'EMOTION_SELF_REPORT', 'CODE_DECOMP_TREE_CHECKED', 'CODE_DECOMP_NODE_HINT_VIEWED', 'CODE_DECOMP_NODE_REVEALED', 'CODE_DECOMP_STAGE_ADVANCED', 'CODE_DECOMP_MATCH_CHECKED');
ALTER TABLE "activity_logs" ALTER COLUMN "action" TYPE "ActivityAction_new" USING ("action"::text::"ActivityAction_new");
ALTER TYPE "ActivityAction" RENAME TO "ActivityAction_old";
ALTER TYPE "ActivityAction_new" RENAME TO "ActivityAction";
DROP TYPE "public"."ActivityAction_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "kc_content_mappings" DROP CONSTRAINT "kc_content_mappings_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "kc_edges" DROP CONSTRAINT "kc_edges_from_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "kc_edges" DROP CONSTRAINT "kc_edges_to_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "kc_evidence" DROP CONSTRAINT "kc_evidence_grading_result_id_fkey";

-- DropForeignKey
ALTER TABLE "kc_evidence" DROP CONSTRAINT "kc_evidence_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_components" DROP CONSTRAINT "knowledge_components_topic_id_fkey";

-- DropForeignKey
ALTER TABLE "proposed_kcs" DROP CONSTRAINT "proposed_kcs_related_to_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "proposed_kcs" DROP CONSTRAINT "proposed_kcs_subtopic_id_fkey";

-- DropForeignKey
ALTER TABLE "proposed_kcs" DROP CONSTRAINT "proposed_kcs_topic_id_fkey";

-- DropForeignKey
ALTER TABLE "question_kcs" DROP CONSTRAINT "question_kcs_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "question_kcs" DROP CONSTRAINT "question_kcs_question_id_fkey";

-- DropForeignKey
ALTER TABLE "user_mastery" DROP CONSTRAINT "user_mastery_kc_id_fkey";

-- DropForeignKey
ALTER TABLE "user_mastery" DROP CONSTRAINT "user_mastery_user_id_fkey";

-- AlterTable
ALTER TABLE "activity_logs" DROP COLUMN "kc_id";

-- AlterTable
ALTER TABLE "session_summaries" DROP COLUMN "mastery_deltas";

-- DropTable
DROP TABLE "curriculum_coverage_runs";

-- DropTable
DROP TABLE "kc_content_mappings";

-- DropTable
DROP TABLE "kc_edges";

-- DropTable
DROP TABLE "kc_evaluation_runs";

-- DropTable
DROP TABLE "kc_evidence";

-- DropTable
DROP TABLE "kc_graph_layouts";

-- DropTable
DROP TABLE "knowledge_components";

-- DropTable
DROP TABLE "knowledge_versions";

-- DropTable
DROP TABLE "proposed_kcs";

-- DropTable
DROP TABLE "publish_gate_runs";

-- DropTable
DROP TABLE "question_kcs";

-- DropTable
DROP TABLE "user_mastery";

-- DropEnum
DROP TYPE "ProposedKCStatus";
