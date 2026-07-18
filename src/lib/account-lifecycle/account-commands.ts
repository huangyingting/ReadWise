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

import { removeAccount } from "@/lib/account-lifecycle/account-removal";
import { prisma } from "@/lib/prisma";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
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
          goalPath: true,
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

      // #1013: weekly study-plan snapshots (derived metadata only). Keep
      // ordering stable and export no ids, user ids, or raw source content.
      studyPlanSnapshots: {
        select: {
          weekStart: true,
          weekEnd: true,
          generatedAt: true,
          summary: true,
          isStarter: true,
          weakAreas: true,
          items: true,
          sourceVersion: true,
          createdAt: true,
        },
        orderBy: { weekStart: "asc" },
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

      // Reading placement (#806) — CONTROLLED columns only. No passage text,
      // question/answer text, or looked-up words are ever stored or exported.
      placementResult: {
        select: {
          seedLevel: true,
          recommendedLevel: true,
          questionCount: true,
          correctCount: true,
          skipped: true,
          completedAt: true,
        },
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

export async function deleteOwnAccount(
  userId: string,
  audit?: AuditRequestInput,
): Promise<DeleteAccountResult> {
  const result = await removeAccount(userId, {
    audit: audit ? () => audit : undefined,
    mediaRetirementOperation: "account-delete",
  });

  if (!result.ok && result.reason === "not-found") {
    return { ok: false, error: "Account not found", status: 404 };
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        "You are the last admin — transfer the Admin role to another user before deleting your account.",
      status: 409,
    };
  }

  return { ok: true };
}
