-- AlterTable: additive nullable column for the model's pre-fill captured when a
-- coder creates/confirms a timeline mark (Part B activity / Part C affect).
ALTER TABLE "Annotation" ADD COLUMN "machineGuess" TEXT;
