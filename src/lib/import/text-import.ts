import type { Session } from "next-auth";
import { ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { countWords } from "@/lib/articles";
import { heuristicDifficulty } from "@/lib/difficulty";
import { privateImportedArticleCreateFields } from "@/lib/article-access";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { assertWithinDailyQuota } from "@/lib/import/quota";

/** Minimum word count for a pasted text import (mirrors the scraper's 50-word rejection). */
export const MIN_IMPORT_WORDS = 50;
/** Max length for pasted text body. */
export const MAX_TEXT_BYTES = 200_000;

export type TextImportInput = {
  title: string;
  text: string;
  userId: string;
  req: Request;
  session: Session;
  requestId: string;
};

export type TextImportResult = { status: 201; id: string };

/**
 * Imports an article from pasted text for the given user.
 *
 * Flow:
 *  1. Reject empty text.
 *  2. Enforce daily quota.
 *  3. Convert paragraph blocks to sanitized HTML via {@link sanitizeArticleHtml}.
 *  4. Validate minimum word count.
 *  5. Create article + apply heuristic difficulty + record audit log (in a transaction).
 *  6. Record analytics event (metadata only).
 */
export async function importArticleFromText(
  input: TextImportInput,
): Promise<TextImportResult> {
  const { title, text, userId, req, session, requestId } = input;

  if (!text.trim()) {
    throw new ApiError(400, "text must not be empty.");
  }

  await assertWithinDailyQuota(userId);

  // Wrap each paragraph block in a <p> tag, then sanitize.
  const rawHtml = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  const content = sanitizeArticleHtml(rawHtml);
  const wordCount = countWords(content);
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  if (wordCount < MIN_IMPORT_WORDS) {
    throw new ApiError(400, `Article text is too short (minimum ${MIN_IMPORT_WORDS} words).`);
  }

  const article = await prisma.$transaction(async (tx) => {
    const created = await tx.article.create({
      data: {
        title,
        source: "Personal",
        content,
        wordCount,
        readingMinutes,
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
        ...privateImportedArticleCreateFields(userId),
      },
      select: { id: true },
    });
    await applyHeuristicDifficulty(created.id, content, tx);
    await recordAuditFromRequest(
      {
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.articleImport,
        targetType: "article",
        targetId: created.id,
        metadata: { importType: "text" },
      },
      tx,
    );
    return created;
  });

  // Product analytics: metadata only — never record article text or body.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.import,
    userId,
    articleId: article.id,
    properties: { importType: "text" },
  });

  return { status: 201, id: article.id };
}

/** Runs heuristic (no-AI) difficulty and persists it. Non-fatal. */
async function applyHeuristicDifficulty(
  articleId: string,
  content: string,
  client: Pick<Prisma.TransactionClient, "article"> = prisma,
): Promise<void> {
  try {
    const { level: difficulty, score: difficultyScore } = heuristicDifficulty(content);
    await client.article.update({
      where: { id: articleId },
      data: { difficulty, difficultyScore },
    });
  } catch {
    // Non-fatal — difficulty can be computed lazily by the reader.
  }
}
