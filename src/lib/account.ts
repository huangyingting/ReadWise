/**
 * Self-service account management helpers (Issue #36).
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

// ── Types ──────────────────────────────────────────────────────────────────

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

// ── Export ─────────────────────────────────────────────────────────────────

export async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({
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
    },
  });

  return user;
}

// ── Deletion ───────────────────────────────────────────────────────────────

// Sentinel thrown inside a transaction to signal the last-admin guard fired.
class LastAdminError extends Error {
  constructor() {
    super("last-admin");
  }
}

export async function deleteOwnAccount(userId: string): Promise<DeleteAccountResult> {
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
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const adminCount = await tx.user.count({ where: { role: "Admin" } });
        if (adminCount <= 1) throw new LastAdminError();
      }
      await tx.user.delete({ where: { id: userId } });
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
  return { ok: true };
}
