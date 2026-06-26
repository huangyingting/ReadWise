/**
 * Barrel for the AI tutor subsystem (FE-16). Re-exports the tutor render
 * components and conversation/textarea/scroll hooks so callers can import from
 * `@/components/tutor` instead of reaching into individual files.
 */
export * from "./TutorMarkdownRenderer";
export * from "./TutorMessageRows";
export * from "./useAutoGrowingTextarea";
export * from "./useAutoScrollLog";
export * from "./useTutorConversation";
