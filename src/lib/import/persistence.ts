/** Persistence pieces shared by the pasted-text and URL import flows. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { heuristicDifficulty } from "@/lib/difficulty";

/**
 * Minimal Prisma client shape needed for the import transaction.
 *
 * Using a narrow interface avoids the union-overload issue with PrismaClient's
 * full `$transaction` signature and keeps the dep type easy to stub in tests.
 */
export type ImportDb = {
  $transaction<R>(fn: (tx: any) => Promise<R>): Promise<R>;
};

/** Runs deterministic difficulty and persists it. Non-fatal. */
export async function applyDeterministicDifficulty(
  articleId: string,
  content: string,
  client: Pick<Prisma.TransactionClient, "article"> = prisma,
): Promise<void> {
  try {
    const {
      level: difficulty,
      score: difficultyScore,
      lexileApprox,
      version: difficultyVersion,
    } = heuristicDifficulty(content);
    await client.article.update({
      where: { id: articleId },
      data: { difficulty, difficultyScore, lexileApprox, difficultyVersion },
    });
  } catch {
    // Non-fatal — difficulty can be computed lazily by the reader.
  }
}
