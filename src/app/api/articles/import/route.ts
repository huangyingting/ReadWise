export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scrapeUrl } from "@/lib/scraper";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { countWords } from "@/lib/articles";
import { prisma } from "@/lib/prisma";
import { heuristicDifficulty } from "@/lib/difficulty";

/** Max personal imports per user per calendar day. */
const DAILY_IMPORT_LIMIT = 5;
/** Max length for pasted text body. */
const MAX_TEXT_BYTES = 200_000;

const importBody = object({
  url: optional(nonEmptyString(2000)),
  title: optional(nonEmptyString(500)),
  text: optional(string({ min: 0, max: MAX_TEXT_BYTES })),
});

/** Returns the start of the current UTC day. */
function utcDayStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * POST /api/articles/import
 *
 * Authenticated: creates a PERSONAL article for the calling user.
 * Accepts either `{url}` (scrape + extract) or `{title, text}` (paste text).
 * The resulting article is private: only visible to its owner in the reader.
 * Rate-limited to 5 submissions per UTC day per user.
 */
export const POST = createHandler(
  { body: importBody },
  async ({ body, session }) => {
    const userId = session.user.id;

    // --- Rate limit: 5 personal imports per UTC day ----------------------
    const dayStart = utcDayStart();
    const todayCount = await prisma.article.count({
      where: { ownerId: userId, createdAt: { gte: dayStart } },
    });
    if (todayCount >= DAILY_IMPORT_LIMIT) {
      throw new ApiError(
        429,
        `You have reached the daily import limit (${DAILY_IMPORT_LIMIT} articles per day). Try again tomorrow.`,
      );
    }

    // --- Branch: URL import or text paste --------------------------------
    if (body.url) {
      return handleUrlImport(body.url, userId);
    }

    if (body.text !== undefined && body.text !== null) {
      const title = body.title?.trim() || "Untitled import";
      return handleTextImport(title, body.text, userId);
    }

    throw new ApiError(400, "Provide either `url` or `text` in the request body.");
  },
);

// ---------------------------------------------------------------------------

async function handleUrlImport(rawUrl: string, userId: string): Promise<Response> {
  // SSRF guard — must not be bypassed.
  try {
    await assertSafeUrl(rawUrl);
  } catch (err) {
    throw new ApiError(
      422,
      `Invalid or unsafe URL: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let scraped;
  try {
    scraped = await scrapeUrl(rawUrl);
  } catch (err) {
    throw new ApiError(
      422,
      `Scrape failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!scraped) {
    throw new ApiError(
      422,
      "Could not extract article content from that URL. The page may be behind a paywall or use an unsupported format.",
    );
  }

  const article = await prisma.article.create({
    data: {
      title: scraped.title,
      author: scraped.author,
      source: scraped.source,
      sourceUrl: scraped.sourceUrl,
      heroImage: scraped.heroImage,
      excerpt: scraped.excerpt,
      content: scraped.content,
      category: scraped.category,
      wordCount: scraped.wordCount,
      readingMinutes: scraped.readingMinutes,
      status: "published",
      publishedAt: scraped.publishedAt ?? new Date(),
      ownerId: userId,
    },
    select: { id: true },
  });

  // Heuristic difficulty assessment (cheap, no AI needed).
  await applyHeuristicDifficulty(article.id, scraped.content);

  return NextResponse.json({ id: article.id }, { status: 201 });
}

async function handleTextImport(
  title: string,
  text: string,
  userId: string,
): Promise<Response> {
  if (!text.trim()) {
    throw new ApiError(400, "text must not be empty.");
  }

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

  const article = await prisma.article.create({
    data: {
      title,
      source: "Personal",
      content,
      wordCount,
      readingMinutes,
      status: "published",
      publishedAt: new Date(),
      ownerId: userId,
    },
    select: { id: true },
  });

  await applyHeuristicDifficulty(article.id, content);

  return NextResponse.json({ id: article.id }, { status: 201 });
}

/** Runs heuristic (no-AI) difficulty and persists it. Non-fatal. */
async function applyHeuristicDifficulty(
  articleId: string,
  content: string,
): Promise<void> {
  try {
    const { level: difficulty, score: difficultyScore } = heuristicDifficulty(content);
    await prisma.article.update({
      where: { id: articleId },
      data: { difficulty, difficultyScore },
    });
  } catch {
    // Non-fatal — difficulty can be computed lazily by the reader.
  }
}
