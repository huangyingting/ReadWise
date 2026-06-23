export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { scrapeUrl, saveDraftArticle } from "@/lib/scraper";
import { revalidateArticlesCache } from "@/lib/cache";
import { findPublicLibraryArticleBySourceUrl } from "@/lib/article-access";
import { AUDIT_ACTIONS } from "@/lib/audit";

const ingestBody = object({ url: nonEmptyString(2000) });

/**
 * Scrapes a single URL and saves it as a draft article. Returns the new
 * article id on success, or throws an ApiError on scrape failure / duplicate.
 */
export const POST = createAdminHandler(
  { body: ingestBody },
  async ({ req, body, session, requestId }) => {
    const url = body.url;

    let scraped;
    try {
      scraped = await scrapeUrl(url);
    } catch (err) {
      throw new ApiError(
        422,
        `Scrape failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!scraped) {
      throw new ApiError(
        422,
        "Could not extract article content from that URL (body too short or unsupported format).",
      );
    }

    const outcome = await saveDraftArticle(scraped, (created) => ({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleIngest,
      targetType: "article",
      targetId: created.id,
      metadata: { status: "saved" },
    }));

    if (outcome.status === "skipped") {
      // Duplicate — return the existing article id so the UI can link to it
      const existing = await findPublicLibraryArticleBySourceUrl(outcome.sourceUrl);
      return NextResponse.json(
        {
          status: "duplicate",
          id: existing?.id ?? null,
          message: "An article from this URL already exists.",
        },
        { status: 409 },
      );
    }

    if (outcome.status === "failed") {
      throw new ApiError(422, `Save failed: ${outcome.reason}`);
    }

    revalidateArticlesCache();
    return NextResponse.json(
      { status: "saved", id: outcome.id },
      { status: 201 },
    );
  },
);
