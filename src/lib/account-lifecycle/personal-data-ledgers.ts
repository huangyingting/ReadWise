import { countAiInvocationsForUser, deleteAiInvocationsForUser } from "@/lib/ai/retention";
import { countEventsForUser, deleteEventsForUser } from "@/lib/analytics/events/retention";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/security/audit";

type LedgerClient = Pick<typeof prisma, "analyticsEvent" | "aiInvocation" | "auditLog">;

export type PersonalDataLedgerErasureOptions = {
  userId: string;
  operatorId: string | null;
  dryRun: boolean;
};

export type PersonalDataLedgerErasureResult = {
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

function erasureResult(
  options: PersonalDataLedgerErasureOptions,
  analyticsEventsMatched: number,
  aiInvocationsMatched: number,
  analyticsEventsDeleted: number,
  aiInvocationsDeleted: number,
): PersonalDataLedgerErasureResult {
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

async function countRows(
  options: PersonalDataLedgerErasureOptions,
  client: LedgerClient,
): Promise<PersonalDataLedgerErasureResult> {
  const [analyticsEventsMatched, aiInvocationsMatched] = await Promise.all([
    countEventsForUser(options.userId, client),
    countAiInvocationsForUser(options.userId, client),
  ]);
  return erasureResult(options, analyticsEventsMatched, aiInvocationsMatched, 0, 0);
}

async function executeErasure(
  options: PersonalDataLedgerErasureOptions,
  client: LedgerClient,
): Promise<PersonalDataLedgerErasureResult> {
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

/**
 * Counts or erases the non-cascading analytics and AI rows associated with a
 * user. Execute mode is transactional and records metadata-only counts.
 */
export async function erasePersonalDataLedgers(
  options: PersonalDataLedgerErasureOptions,
  deps: ErasureDeps = {},
): Promise<PersonalDataLedgerErasureResult> {
  const client = deps.client ?? prisma;
  if (options.dryRun) return countRows(options, client);
  const transaction = deps.transaction ?? ((fn) => prisma.$transaction(fn));
  return transaction((tx) => executeErasure(options, tx));
}