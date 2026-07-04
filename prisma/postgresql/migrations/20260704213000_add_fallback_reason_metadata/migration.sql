-- Safe, low-cardinality fallback reason metadata for AI ledger and processing steps.
-- Values are enums/labels only; prompts, article text, selected text, and model
-- output remain excluded from operational metadata.
ALTER TABLE "ArticleProcessingStep" ADD COLUMN "fallbackReason" TEXT;
ALTER TABLE "AiInvocation" ADD COLUMN "fallbackReason" TEXT;

CREATE INDEX "ArticleProcessingStep_fallbackReason_idx" ON "ArticleProcessingStep"("fallbackReason");
CREATE INDEX "AiInvocation_fallbackReason_idx" ON "AiInvocation"("fallbackReason");
