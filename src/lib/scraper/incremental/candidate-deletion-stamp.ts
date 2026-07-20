/**
 * Minimal, dependency-light candidate-ledger stamp used by the Article-delete
 * transaction (issue #1104, AC2). Kept as its OWN leaf module — importing only
 * the Prisma transaction type and the controlled reason constant — so the
 * `article-library` delete path does NOT pull in the `@/lib/jobs` barrel (and
 * cannot form an import cycle). Recovery/query helpers live in
 * `deleted-article-recovery.ts`, which re-exports this function for cohesion.
 */
import type { Prisma } from "@prisma/client";

import { ARTICLE_DELETED_TERMINAL_REASON } from "./canonical-conflict-policy";

/**
 * Stamps the permanent DELETED outcome on every candidate that produced
 * `articleId`, INSIDE the caller's Article-delete transaction. MUST run BEFORE
 * `tx.article.delete` (while `articleId` still links) so the guarded, metadata-only
 * update matches. Idempotent via the `articleDeletedAt: null` guard. Returns the
 * number of candidates stamped.
 *
 * PRIVACY: writes only a timestamp + a controlled machine reason CATEGORY
 * (`governance:article-deleted`) — never a URL, body, or article text.
 */
export async function markArticleCandidatesDeletedInTx(
  tx: Prisma.TransactionClient,
  articleId: string,
  now: Date,
): Promise<number> {
  const res = await tx.crawlCandidate.updateMany({
    where: { articleId, articleDeletedAt: null },
    data: {
      articleDeletedAt: now,
      terminalReason: ARTICLE_DELETED_TERMINAL_REASON,
      terminalAt: now,
      updatedAt: now,
    },
  });
  return res.count;
}
