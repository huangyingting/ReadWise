/**
 * Admin member detail read model (REF-052 — Issue #489).
 *
 * Assembles a privacy-conscious support view of a single member for the
 * `/admin/members/[id]` page — profile, reading/study summary, recent activity,
 * imports, and the audit trail of admin actions taken on them.
 *
 * Separated from support commands ({@link ./support-commands}) so the read
 * model can evolve independently of operator mutations.
 *
 * Everything here reads/derives from durable tables only and never exposes raw
 * secrets (session tokens, OAuth credentials) to the operator.
 */

import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { parseTopics } from "@/lib/profile";

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
