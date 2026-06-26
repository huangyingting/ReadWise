/**
 * AI Tutor — re-export barrel (ADR-0010 §6 / Phase 3 #686).
 *
 * The tutor implementation has moved to `@/lib/ai/tutor` so that the
 * multi-model `TutorMessage` transaction and AI-provider orchestration
 * live in the AI subsystem that owns them.
 *
 * Callers should prefer the canonical path `@/lib/ai/tutor`.
 * This shim exists only to avoid a broad one-shot import sweep.
 */
export {
  getTutorMessages,
  askTutor,
  clearTutor,
  MAX_QUESTION_LENGTH,
  type TutorMessageDto,
  type AskTutorResult,
} from "@/lib/ai/tutor";
