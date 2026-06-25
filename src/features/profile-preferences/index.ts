/**
 * profile-preferences subsystem
 *
 * Exports shared value definitions, validation schema, and UI field components
 * for the user profile/preferences domain. Consumed by:
 *   - Onboarding flow (src/app/onboarding/)
 *   - Profile settings form (src/app/(app)/settings/)
 *   - Profile API routes (src/app/api/profile/, src/app/api/onboarding/)
 *
 * Reminder preferences and reader display preferences (font size, theme, TTS)
 * are intentionally kept separate: see src/components/ReminderPreferencesForm.tsx
 * and the reader settings in src/app/(app)/reader/. They relate to profile only
 * insofar as timezone is stored on the profile model.
 */
export * from "./values";
export * from "./schema";
export { TopicSelector } from "./TopicSelector";
export { DailyGoalStepper } from "./DailyGoalStepper";
