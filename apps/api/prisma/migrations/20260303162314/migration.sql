-- AlterTable
ALTER TABLE "content_drafts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "course_feedback_settings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "course_modules" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "curriculum_coverage_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_chunks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "evaluation_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kc_content_mappings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "block_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kc_edges" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kc_evaluation_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kc_graph_layouts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "learning_interventions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "llm_audit_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "llm_generation_jobs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "llm_model_pricing" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "llm_usage_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "module_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "page_content_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "page_eval_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "proposed_kcs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "page_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "publish_gate_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "question_generation_jobs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "questions" ALTER COLUMN "kc_ids" DROP DEFAULT,
ALTER COLUMN "page_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "saved_intervention_reviews" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "source_documents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "spaced_repetition_cards" ALTER COLUMN "id" DROP DEFAULT;
