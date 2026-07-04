import { countAiInvocationsForUser, deleteAiInvocationsForUser } from "@/lib/ai/retention";
import { countEventsForUser, deleteEventsForUser } from "@/lib/analytics/events/retention";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/security/audit";
import { isMain, parseFlag, parseString, runCli } from "./lib/cli";

const HELP = `Usage: npm run privacy:erase-ledgers -- --user-id <id> [--dry-run|--execute] [--operator-id <id>]\n\nCounts or erases non-cascading per-user analytics and AI ledger rows. Defaults\nto dry-run/count mode. Use --execute for deletion. Output and audit metadata\ncontain counts/ids only; prompts, article text, selected text, tokens, cookies,\nand other private content are never read or persisted.\n\nOptions:\n  --user-id <id>       User id whose analytics/AI ledger rows should be erased\n  --operator-id <id>   Operator id for the audit record (default: system)\n  --dry-run            Count rows only (default)\n  --execute            Delete matched rows and write an audit record atomically\n  --help, -h           Show this help\n`;

type LedgerClient = Pick<typeof prisma, "analyticsEvent" | "aiInvocation" | "auditLog">;

type ErasureOptions = {
  userId: string;
  operatorId: string | null;
  dryRun: boolean;
};

export type LedgerErasureResult = {
  userId: string;
  dryRun: boolean;
  executed: boolean;
  analyticsEventsMatched: number;
  aiInvocationsMatched: number;
  analyticsEventsDeleted: number;
  aiInvocationsDeleted: number;
};

type ErasureDeps = {
  client?: LedgerClient;
  transaction?: <T>(fn: (client: LedgerClient) => Promise<T>) => Promise<T>;
};

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function normalizeUserId(value: string | null): string {
  return (value ?? "").trim();
}

function parseOptions(argv: string[]): ErasureOptions | "help" | "invalid" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  const userId = normalizeUserId(parseString(argv, "--user-id"));
  if (!userId) return "invalid";
  const operatorId = normalizeUserId(parseString(argv, "--operator-id")) || null;
  return { userId, operatorId, dryRun: !parseFlag(argv, "--execute") };
}

function erasureResult(
  options: ErasureOptions,
  analyticsEventsMatched: number,
  aiInvocationsMatched: number,
  analyticsEventsDeleted: number,
  aiInvocationsDeleted: number,
): LedgerErasureResult {
  return {
    userId: options.userId,
    dryRun: options.dryRun,
    executed: !options.dryRun,
    analyticsEventsMatched,
    aiInvocationsMatched,
    analyticsEventsDeleted,
    aiInvocationsDeleted,
  };
}

async function countRows(options: ErasureOptions, client: LedgerClient): Promise<LedgerErasureResult> {
  const [analyticsEventsMatched, aiInvocationsMatched] = await Promise.all([
    countEventsForUser(options.userId, client),
    countAiInvocationsForUser(options.userId, client),
  ]);
  return erasureResult(options, analyticsEventsMatched, aiInvocationsMatched, 0, 0);
}

async function executeErasure(options: ErasureOptions, client: LedgerClient): Promise<LedgerErasureResult> {
  const [analyticsEventsMatched, aiInvocationsMatched] = await Promise.all([
    countEventsForUser(options.userId, client),
    countAiInvocationsForUser(options.userId, client),
  ]);
  const [analyticsEventsDeleted, aiInvocationsDeleted] = await Promise.all([
    deleteEventsForUser(options.userId, client),
    deleteAiInvocationsForUser(options.userId, client),
  ]);
  const result = erasureResult(
    options,
    analyticsEventsMatched,
    aiInvocationsMatched,
    analyticsEventsDeleted,
    aiInvocationsDeleted,
  );
  await recordAuditLog({
    action: AUDIT_ACTIONS.adminLedgerErasure,
    actorId: options.operatorId ?? "system",
    actorRole: options.operatorId ? "Operator" : "System",
    targetType: "user",
    targetId: options.userId,
    metadata: {
      analyticsEventsMatched,
      aiInvocationsMatched,
      analyticsEventsDeleted,
      aiInvocationsDeleted,
    },
  }, client);
  return result;
}

export async function eraseUserLedgers(
  options: ErasureOptions,
  deps: ErasureDeps = {},
): Promise<LedgerErasureResult> {
  const client = deps.client ?? prisma;
  if (options.dryRun) return countRows(options, client);
  const transaction = deps.transaction ?? ((fn) => prisma.$transaction(fn));
  return transaction((tx) => executeErasure(options, tx));
}

export async function eraseUserLedgersMain(argv = process.argv.slice(2), io: CliIo = {}): Promise<number> {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const options = parseOptions(argv);
  if (options === "help") {
    log(HELP.trimEnd());
    return 0;
  }
  if (options === "invalid") {
    error("Missing required --user-id <id>. Use --help for usage.");
    return 2;
  }
  const result = await eraseUserLedgers(options);
  log(JSON.stringify(result, null, 2));
  if (!result.executed) {
    error("Dry run only. Re-run with --execute to delete matched rows and write an audit record.");
  }
  return 0;
}

if (isMain(import.meta.url)) runCli(() => eraseUserLedgersMain());
