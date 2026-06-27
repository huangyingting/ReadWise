/**
 * Self-service account commands (REF-052 — Issue #489).
 *
 * exportUserData — returns a complete JSON bundle of everything the user owns.
 *   OAuth access/refresh/id tokens are intentionally EXCLUDED from the export;
 *   only the provider name is included so the user can see which services are
 *   linked without exposing token material.
 *
 * deleteOwnAccount — deletes the User row (cascades all related data) after
 *   checking the last-admin guard so the system is never left adminless.
 */

import { prisma } from "@/lib/prisma";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import { getMediaStorage } from "@/lib/storage/runtime";
import type { Prisma } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────────

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

// ── Export ─────────────────────────────────────────────────────────────────

type AccountClient = Pick<Prisma.TransactionClient, "user" | "auditLog">;

async function readUserExport(userId: string, client: AccountClient = prisma) {
  return client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      createdAt: true,
      updatedAt: true,

      // Linked OAuth providers — names only, NO token material.
      accounts: {
        select: {
          provider: true,
          type: true,
          // Deliberately omitted: access_token, refresh_token, id_token,
          // session_state, providerAccountId, expires_at, token_type, scope.
        },
      },

      profile: {
        select: {
          ageRange: true,
          gender: true,
          englishLevel: true,
          topics: true,
          dailyGoal: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },

      savedWords: {
        select: {
          word: true,
          explanation: true,
          example: true,
          articleId: true,
          dueAt: true,
          intervalDays: true,
          easeFactor: true,
          repetitions: true,
          lastReviewedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      readingProgress: {
        select: {
          articleId: true,
          percent: true,
          completed: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      dailyActivities: {
        select: {
          date: true,
          articlesRead: true,
          createdAt: true,
        },
        orderBy: { date: "asc" },
      },

      readingLists: {
        select: {
          name: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              articleId: true,
              addedAt: true,
            },
            orderBy: { addedAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },

      highlights: {
        select: {
          articleId: true,
          quote: true,
          startOffset: true,
          endOffset: true,
          prefix: true,
          suffix: true,
          note: true,
          color: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      tutorMessages: {
        select: {
          articleId: true,
          role: true,
          content: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      quizAttempts: {
        select: {
          articleId: true,
          correctCount: true,
          totalQuestions: true,
          scorePct: true,
          completedAt: true,
        },
        orderBy: { completedAt: "asc" },
      },

      pronunciationAttempts: {
        select: {
          articleId: true,
          referenceText: true,
          accuracyScore: true,
          fluencyScore: true,
          completenessScore: true,
          pronScore: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      // 711-A: reminder / push preferences
      reminderPreference: {
        select: {
          enabled: true,
          preferredHour: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          timezone: true,
          createdAt: true,
          updatedAt: true,
        },
      },

      // 711-C: learning mastery and level history
      levelHistory: {
        select: { level: true, changedAt: true },
        orderBy: { changedAt: "asc" },
      },

      wordMastery: {
        select: {
          lemma: true,
          familiarity: true,
          confidence: true,
          exposures: true,
          correctReviews: true,
          incorrectReviews: true,
          sourceArticleIds: true,
          lastSeenAt: true,
          lastReviewedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { lemma: "asc" },
      },

      articleMastery: {
        select: {
          articleId: true,
          readingCompletion: true,
          quizScore: true,
          lookupDensity: true,
          timeSpentMs: true,
          difficultyFeedback: true,
          comprehensionScore: true,
          lastActivityAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { lastActivityAt: "asc" },
      },

      skillMastery: {
        select: {
          skill: true,
          confidence: true,
          evidenceCount: true,
          recentEvidence: true,
          lastUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { skill: "asc" },
      },

      // #810: privacy-safe learning coach memory — controlled aggregate
      // signals only (skill, confidence, evidenceCount, lastObservedAt, trend).
      // No prompts, text, ids, or derivative content.
      learnerCoachMemories: {
        select: {
          skill: true,
          confidence: true,
          evidenceCount: true,
          lastObservedAt: true,
          trend: true,
          createdAt: true,
        },
        orderBy: { skill: "asc" },
      },

      difficultyFeedback: {
        select: {
          articleId: true,
          vote: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      // #807: lightweight Today comprehension self-check outcomes. Controlled
      // fields ONLY — self-rating / skill tag (enums), the boolean MCQ outcome,
      // ids, and the remediation-viewed flag. NEVER question text, answer/option
      // text, article text, or explanations.
      todayComprehensionFeedback: {
        select: {
          todaySessionId: true,
          articleId: true,
          selfRating: true,
          questionId: true,
          mcqCorrect: true,
          skillTag: true,
          remediationViewed: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      // 711-E: tenant membership and assignment history
      memberships: {
        select: {
          orgId: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      classroomMemberships: {
        select: {
          classroomId: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },

      assignmentCompletions: {
        select: {
          assignmentId: true,
          status: true,
          quizScore: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function exportUserData(
  userId: string,
  audit?: AuditRequestInput,
) {
  if (!audit) {
    return readUserExport(userId);
  }

  return prisma.$transaction(async (tx) => {
    const user = await readUserExport(userId, tx);
    await recordAuditFromRequest(audit, tx);
    return user;
  });
}

// ── Deletion ───────────────────────────────────────────────────────────────

// Sentinel thrown inside a transaction to signal the last-admin guard fired.
class LastAdminError extends Error {
  constructor() {
    super("last-admin");
  }
}

export async function deleteOwnAccount(
  userId: string,
  audit?: AuditRequestInput,
): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return { ok: false, error: "Account not found", status: 404 };
  }

  // Article.owner now uses onDelete: Cascade, so deleting the user also deletes
  // their private imports at the database layer. Private articles therefore can
  // never survive as ownerless public rows.
  //
  // The last-admin guard is re-evaluated INSIDE the transaction so two
  // concurrent self-deletes can never both pass the guard and leave the system
  // without an admin.
  //
  // Cascade deletes on the user: accounts, sessions, profile, readingProgress,
  // savedWords, dailyActivities, readingLists (+ items), highlights,
  // tutorMessages, quizAttempts, pronunciationAttempts — all onDelete: Cascade.
  //
  // 711-D: Collect object-storage keys for private-article MediaAssets BEFORE
  // the cascade so we can purge bytes from object storage after the DB delete.
  // The query runs outside the transaction intentionally — storage I/O must not
  // hold a DB lock.
  const ownedAssetKeys = await prisma.mediaAsset.findMany({
    where: { article: { ownerId: userId } },
    select: { storageKey: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const adminCount = await tx.user.count({ where: { role: "Admin" } });
        if (adminCount <= 1) throw new LastAdminError();
      }
      await tx.user.delete({ where: { id: userId } });
      if (audit) {
        await recordAuditFromRequest(audit, tx);
      }
    });
  } catch (e) {
    if (e instanceof LastAdminError) {
      return {
        ok: false,
        error:
          "You are the last admin — transfer the Admin role to another user before deleting your account.",
        status: 409,
      };
    }
    throw e;
  }

  // Best-effort object-storage purge — do not fail the deletion if the storage
  // backend is down or unconfigured (DB-only mode returns null).
  if (ownedAssetKeys.length > 0) {
    const storage = getMediaStorage();
    if (storage) {
      await Promise.allSettled(
        ownedAssetKeys.map(({ storageKey }) => storage.delete(storageKey)),
      );
    }
  }

  return { ok: true };
}
