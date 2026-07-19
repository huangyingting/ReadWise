import {
  erasePersonalDataLedgers,
  type PersonalDataLedgerErasureOptions,
  type PersonalDataLedgerErasureResult,
} from "@/lib/account-lifecycle/personal-data-ledgers";
import { isMain, parseFlag, parseString, runCli } from "./lib/cli";

const HELP = `Usage: npm run privacy:erase-ledgers -- --user-id <id> [--dry-run|--execute] [--operator-id <id>]\n\nCounts or erases non-cascading per-user analytics and AI ledger rows. Defaults\nto dry-run/count mode. Use --execute for deletion. Output and audit metadata\ncontain counts/ids only; prompts, article text, selected text, tokens, cookies,\nand other private content are never read or persisted.\n\nOptions:\n  --user-id <id>       User id whose analytics/AI ledger rows should be erased\n  --operator-id <id>   Operator id for the audit record (default: system)\n  --dry-run            Count rows only (default)\n  --execute            Delete matched rows and write an audit record atomically\n  --help, -h           Show this help\n`;

export type LedgerErasureResult = PersonalDataLedgerErasureResult;
export const eraseUserLedgers = erasePersonalDataLedgers;

type CliIo = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function normalizeUserId(value: string | null): string {
  return (value ?? "").trim();
}

function parseOptions(argv: string[]): PersonalDataLedgerErasureOptions | "help" | "invalid" {
  if (parseFlag(argv, "--help", "-h")) return "help";
  const userId = normalizeUserId(parseString(argv, "--user-id"));
  if (!userId) return "invalid";
  const operatorId = normalizeUserId(parseString(argv, "--operator-id")) || null;
  return { userId, operatorId, dryRun: !parseFlag(argv, "--execute") };
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
  const result = await erasePersonalDataLedgers(options);
  log(JSON.stringify(result, null, 2));
  if (!result.executed) {
    error("Dry run only. Re-run with --execute to delete matched rows and write an audit record.");
  }
  return 0;
}

if (isMain(import.meta.url)) runCli(() => eraseUserLedgersMain());
