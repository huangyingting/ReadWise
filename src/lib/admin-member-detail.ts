/**
 * Admin user-support tooling (Epic RW-E010 — RW-053).
 *
 * Assembles a privacy-conscious support view of a single member for the
 * `/admin/members/[id]` page — profile, reading/study summary, recent activity,
 * imports, and the audit trail of admin actions taken on them — plus the safe,
 * AUDITED support actions an operator can run:
 *   - {@link revokeMemberSessions}: sign the member out everywhere.
 *   - {@link exportMemberData}: assemble a JSON export of their own data.
 *   - {@link triggerMemberRepair}: re-enqueue missing enrichment for their
 *     imported articles (reuses {@link runBackfill}).
 *   - {@link resendSignInHelp}: a documented stub until transactional email
 *     is configured (never leaks tokens/secrets).
 *
 * Everything here reads/derives from durable tables only and never exposes raw
 * secrets (session tokens, OAuth credentials) to the operator.
 */
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import {
  recordAuditFromRequest,
  type AuditRequestInput,
} from "@/lib/audit";
import { parseTopics } from "@/lib/profile";
import { exportUserData } from "@/lib/account";
import {
  runBackfill,
  BACKFILL_FEATURES,
  type BackfillResult,
} from "@/lib/backfill";

type AuditFactory<T> = (result: T) => AuditRequestInput;

const RECENT_ACTIVITY_DAYS = 14;
const RECENT_LIMIT = 10;

export type MemberProgressSummary = {
  started: number;
  completed: number;
  inProgress: number;
  avgPercent: number;
};

export type MemberActivityDay = {
  date: string;
  articlesRead: number;
};

export type MemberImport = {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  createdAt: Date;
};

export type MemberAuditEntry = {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
};

export type MemberSessionInfo = {
  active: number;
  /** Latest expiry across the member's sessions, if any. */
  latestExpiry: Date | null;
};

export type MemberDetail = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: Role;
    emailVerified: Date | null;
    createdAt: Date;
  };
  profile: {
    englishLevel: string;
    topics: string[];
    ageRange: string | null;
    gender: string | null;
    dailyGoal: number;
    completedAt: Date | null;
  } | null;
  progress: MemberProgressSummary;
  savedWords: number;
  quizAttempts: number;
  sessions: MemberSessionInfo;
  recentActivity: MemberActivityDay[];
  imports: MemberImport[];
  importCount: number;
  /** Audit trail of admin actions taken ON this member (newest first). */
  auditTrail: MemberAuditEntry[];
};

type DetailClient = Pick<
  typeof prisma,
  | "user"
  | "readingProgress"
  | "dailyActivity"
  | "article"
  | "session"
  | "auditLog"
>;

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Assembles the support detail for a single member. Returns `null` when the
 * user does not exist. All counts/aggregates come from durable tables; no raw
 * session tokens or OAuth secrets are ever selected.
 */
export async function getMemberDetail(
  id: string,
  client: DetailClient = prisma,
  now: Date = new Date(),
): Promise<MemberDetail | null> {
  const user = await client.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      emailVerified: true,
      createdAt: true,
      profile: {
        select: {
          englishLevel: true,
          topics: true,
          ageRange: true,
          gender: true,
          dailyGoal: true,
          completedAt: true,
        },
      },
      _count: { select: { savedWords: true, quizAttempts: true } },
    },
  });
  if (!user) return null;

  const since = new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

  const [progressAgg, completedCount, startedCount, recentActivity, imports, importCount, sessions, sessionAgg, auditRows] =
    await Promise.all([
      client.readingProgress.aggregate({
        where: { userId: id },
        _avg: { percent: true },
      }),
      client.readingProgress.count({ where: { userId: id, completed: true } }),
      client.readingProgress.count({ where: { userId: id } }),
      client.dailyActivity.findMany({
        where: { userId: id, date: { gte: since } },
        orderBy: { date: "desc" },
        take: RECENT_LIMIT,
        select: { date: true, articlesRead: true },
      }),
      client.article.findMany({
        where: { ownerId: id, sourceType: "IMPORTED" },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          title: true,
          status: true,
          sourceType: true,
          createdAt: true,
        },
      }),
      client.article.count({ where: { ownerId: id, sourceType: "IMPORTED" } }),
      client.session.count({ where: { userId: id, expires: { gt: now } } }),
      client.session.aggregate({
        where: { userId: id },
        _max: { expires: true },
      }),
      client.auditLog.findMany({
        where: { targetType: "user", targetId: id },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          action: true,
          actorId: true,
          actorRole: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ]);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
    profile: user.profile
      ? {
          englishLevel: user.profile.englishLevel,
          topics: parseTopics(user.profile.topics),
          ageRange: user.profile.ageRange,
          gender: user.profile.gender,
          dailyGoal: user.profile.dailyGoal,
          completedAt: user.profile.completedAt,
        }
      : null,
    progress: {
      started: startedCount,
      completed: completedCount,
      inProgress: Math.max(0, startedCount - completedCount),
      avgPercent: Math.round(progressAgg._avg.percent ?? 0),
    },
    savedWords: user._count.savedWords,
    quizAttempts: user._count.quizAttempts,
    sessions: {
      active: sessions,
      latestExpiry: sessionAgg._max.expires ?? null,
    },
    recentActivity: recentActivity.map((a) => ({
      date: a.date.toISOString().slice(0, 10),
      articlesRead: a.articlesRead,
    })),
    imports: imports.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      sourceType: a.sourceType,
      createdAt: a.createdAt,
    })),
    importCount,
    auditTrail: auditRows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      actorRole: row.actorRole,
      createdAt: row.createdAt,
      metadata: safeParseMetadata(row.metadata),
    })),
  };
}

// ---------------------------------------------------------------------------
// Support actions (all audited)
// ---------------------------------------------------------------------------

export type SupportActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number };

type RevokeClient = Pick<typeof prisma, "user" | "session">;

/**
 * Revokes (deletes) every `Session` row for the member, signing them out of all
 * devices. With the database session strategy this is real server-side
 * revocation, not just a cookie clear. Audited via the supplied factory.
 */
export async function revokeMemberSessions(
  userId: string,
  audit?: AuditFactory<{ revoked: number }>,
  client: RevokeClient = prisma,
): Promise<SupportActionResult<{ revoked: number }>> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const result = await client.session.deleteMany({ where: { userId } });
  if (audit) {
    await recordAuditFromRequest(audit({ revoked: result.count }));
  }
  return { ok: true, revoked: result.count };
}

/**
 * Assembles a JSON export of the member's OWN data (profile, progress, saved
 * words, highlights, etc.) for a support / data-subject-access request. Reuses
 * {@link exportUserData} so the export shape stays consistent with the
 * self-service account export. The export is audited.
 */
export async function exportMemberData(
  userId: string,
  audit?: AuditRequestInput,
): Promise<SupportActionResult<{ data: unknown }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const data = await exportUserData(userId, audit);
  if (!data) return { ok: false, error: "Not found", status: 404 };
  return { ok: true, data };
}

/**
 * Triggers a data-repair / rebuild for the member's IMPORTED articles by
 * re-enqueuing any missing enrichment (difficulty/tags/vocab/quiz/…) via
 * {@link runBackfill} in "missing" mode (nothing is destructively cleared;
 * user study data is never touched). No-op (ok, 0 enqueued) when the member has
 * no imported articles. Audited via the supplied factory.
 */
export async function triggerMemberRepair(
  userId: string,
  operatorId: string | null,
  audit?: AuditFactory<{ result: BackfillResult; articleCount: number }>,
): Promise<SupportActionResult<{ result: BackfillResult | null; articleCount: number }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const owned = await prisma.article.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const articleIds = owned.map((a) => a.id);
  if (articleIds.length === 0) {
    if (audit) {
      await recordAuditFromRequest(
        audit({
          result: {
            dryRun: false,
            mode: "missing",
            features: [...BACKFILL_FEATURES],
            reason: `support repair for user ${userId}`,
            scanned: 0,
            matched: 0,
            cap: 0,
            enqueued: 0,
            skippedExisting: 0,
            cleared: 0,
            jobIds: [],
            plan: [],
          },
          articleCount: 0,
        }),
      );
    }
    return { ok: true, result: null, articleCount: 0 };
  }

  const result = await runBackfill({
    features: [...BACKFILL_FEATURES],
    mode: "missing",
    reason: `support repair for user ${userId}`,
    operatorId,
    filter: { articleIds },
  });
  if (audit) {
    await recordAuditFromRequest(
      audit({ result, articleCount: articleIds.length }),
    );
  }
  return { ok: true, result, articleCount: articleIds.length };
}

/**
 * Resend sign-in help. Transactional email is not configured in this
 * deployment, so this is a documented stub: it records the support intent in
 * the audit log (so the action is traceable) and reports that email delivery is
 * unavailable. It NEVER exposes a magic link, token, or any secret. Wire real
 * delivery here when an email provider is configured.
 */
export async function resendSignInHelp(
  userId: string,
  audit?: AuditFactory<{ delivered: boolean }>,
): Promise<SupportActionResult<{ delivered: boolean; reason: string }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };
  if (!user.email) {
    return { ok: false, error: "Member has no email address on file", status: 400 };
  }

  // No email provider configured — record the intent and report unavailability.
  if (audit) {
    await recordAuditFromRequest(audit({ delivered: false }));
  }
  return {
    ok: true,
    delivered: false,
    reason: "email_not_configured",
  };
}
