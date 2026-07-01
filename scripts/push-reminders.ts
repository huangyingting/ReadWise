/**
 * push-reminders CLI — sends SRS due-card push notifications to subscribed users.
 *
 * Usage:
 *   npm run push-reminders
 *   npm run push-reminders -- --dry-run
 *
 * Designed to be cron'd daily, e.g.:
 *   0 9 * * * cd /app && npm run push-reminders
 *
 * Uses the same TS-CLI harness as worker.ts / scrape.ts.
 */
import { isPushConfigured } from "@/lib/push/provider";
import { sendDueReminders } from "@/lib/push/scheduler";
import { createLogger } from "@/lib/observability/logger";
import { runScript, isMain, parseFlag } from "./lib/cli";

const log = createLogger("push-reminders");

type Args = {
  dryRun: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  return {
    dryRun: parseFlag(argv, "--dry-run"),
    help: parseFlag(argv, "--help", "-h"),
  };
}

function printHelp() {
  console.log(`
push-reminders — send SRS review push notifications

Usage:
  npm run push-reminders [-- [options]]

Options:
  --dry-run   Check configuration and due counts without sending any push.
  --help      Show this message.

Environment:
  VAPID_PUBLIC_KEY   Required. VAPID public key.
  VAPID_PRIVATE_KEY  Required. VAPID private key.
  VAPID_SUBJECT      Required. mailto: address for VAPID contact.
  DATABASE_URL       Required. Prisma datasource URL.
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return 0;
  }

  if (!isPushConfigured()) {
    log.warn("VAPID keys not configured — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT");
    return 0;
  }

  if (args.dryRun) {
    log.info("dry-run: push is configured; would send due reminders (skipping actual send)");
    return 0;
  }

  log.info("sending due-card push reminders…");
  const result = await sendDueReminders();
  log.info("done", {
    usersWithDue: result.usersWithDue,
    sent: result.sent,
    skipped: result.skipped,
    suppressed: result.suppressed,
  });
  return 0;
}

export { main, parseArgs };

if (isMain(import.meta.url)) {
  runScript(main, "push-reminders failed");
}
