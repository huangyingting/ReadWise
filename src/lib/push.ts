/**
 * Web Push / VAPID support for SRS review reminders — public API barrel.
 *
 * Implementation is split into focused submodules under `src/lib/push/`:
 *   - `push/provider.ts`           — VAPID config + web-push initialisation
 *   - `push/subscription-health.ts`— failure tracking and endpoint pruning
 *   - `push/delivery.ts`           — sendToSubs + sendPushToUser
 *   - `push/scheduler.ts`          — sendDueReminders (due-card discovery)
 *
 * All existing imports (`@/lib/push`) continue to resolve here.
 *
 * Follows the same graceful-fallback convention as AI/Speech:
 *   `isPushConfigured()` → false when VAPID env vars are absent.
 *   All public functions are no-ops (or return early) when unconfigured.
 *
 * Server-only — never import this from a Client Component or the SW script.
 */
export { isPushConfigured, vapidPublicKey } from "./push/provider";
export { type PushPayload, sendPushToUser } from "./push/delivery";
export { type ReminderResult, sendDueReminders } from "./push/scheduler";
