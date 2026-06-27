# Push notifications and study reminders

Push notifications are an optional platform subsystem used today for due-card
study reminders. Missing VAPID configuration is expected in local/test
environments and degrades to no-op sends.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Provider setup | `src/lib/push/provider.ts` | Web Push/VAPID initialization and configuration check. |
| Delivery | `src/lib/push/delivery.ts` | Fan-out to pre-loaded subscriptions and update delivery health. |
| Scheduler | `src/lib/push/scheduler.ts` | Find due users and send one reminder per eligible user. |
| Subscription health | `src/lib/push/subscription-health.ts` | Success/failure counters and dead-subscription pruning. |
| Schemas | `src/lib/push/schemas.ts` | Route payload validation. |
| Preferences | `src/lib/reminder-preferences.ts` | Enabled flag, preferred hour, quiet hours, timezone. |
| API routes | `src/app/api/push/**` | VAPID key, subscribe/unsubscribe, preferences. |
| CLI | `scripts/push-reminders.ts` | Manual/scheduled reminder dispatch. |

## Configuration

| Env | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Public key returned to the browser. |
| `VAPID_PRIVATE_KEY` | Server-side signing key. |
| `VAPID_SUBJECT` | Contact URI/email for push services. |

When any required value is missing, `isPushConfigured()` is false. Scheduler and
delivery calls return zero counts and log a no-op rather than throwing.

Readiness reports push as configured/degraded/unconfigured but does not fail the
app for missing push config; see [`health-readiness.md`](./health-readiness.md).

## Subscription lifecycle

`PushSubscription` stores one row per browser endpoint:

- `endpoint` is unique,
- `p256dh` and `auth` are the Web Push keys,
- `failureCount`, `lastSuccessAt`, and `lastFailureAt` track delivery health,
- rows cascade with the user.

Subscribe/unsubscribe routes must source `userId` from the session. The browser
never supplies the owner id.

## Delivery health

`sendToSubs(subs, payload)` accepts pre-loaded subscriptions so batch jobs avoid
N+1 queries. It then:

1. sends all payloads in parallel,
2. resets failure counters for successes,
3. increments transient failure counters,
4. prunes endpoints that return `404`/`410`,
5. prunes endpoints that exceed the consecutive-failure threshold.

Delivery returns the number of successful pushes. A failure to one subscription
does not abort the rest of the batch.

## Reminder scheduling

`sendDueReminders()` finds users with at least one due `SavedWord`, loads all of
their subscriptions in one query, applies reminder preferences, then sends a
single "cards due" notification per eligible subscribed user.

Preference gates:

- disabled reminders suppress sends,
- `preferredHour` restricts to the user's local hour,
- quiet hours can wrap midnight,
- timezone comes from reminder preference, then profile timezone, then fallback.

The result object reports `usersWithDue`, `sent`, `skipped`, and `suppressed` so
operators can distinguish missing subscriptions from preference suppression.

### Today Session deep link

The notification deep link and copy are gated by the Today Session feature flag
(`FEATURE_TODAY_SESSION_ENABLED`, read via `isTodaySessionFeatureEnabled()`):

- when enabled (the default), reminders use Today-specific generic copy and deep
  link to `/today`;
- when disabled, reminders keep the prior due-word copy and `/study` target.

Either way the payload carries only generic copy plus a numeric due-word count —
no article, word, definition, or note content.

## Privacy

Notification payloads should contain generic reminder copy and a deep link. Do
not include saved words, article text, definitions, prompts, or private content
in push payloads; push services are third parties.

## Operational checks

- Use `/api/ready` to confirm provider configuration status.
- Use `scripts/push-reminders.ts` or the scheduled platform job to run reminder
  dispatch.
- Watch delivery logs and subscription failure counters before changing the
  pruning threshold.
- Treat missing VAPID config as expected unless your deployment explicitly
  requires reminders.

## Tests

Relevant coverage includes `tests/push.test.ts`, `tests/reminder-preferences.test.ts`,
route tests for `src/app/api/push/**`, and worker/job tests for
`PUSH_REMINDER` jobs.
