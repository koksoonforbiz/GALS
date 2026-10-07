-- Phase 5: cascade classification and transfer-score rows with the student.
ALTER TABLE "ai_prompt_classifications" ADD CONSTRAINT "ai_prompt_classifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;;
ALTER TABLE "transfer_task_scores" ADD CONSTRAINT "transfer_task_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;;
