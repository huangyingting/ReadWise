export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { scrapeAndSave, type UrlIntakeOutcome } from "@/lib/scraper";
import { revalidateArticlesCache } from "@/lib/cache";
import { findPublicLibraryArticleBySourceUrl } from "@/lib/article-library";
import { AUDIT_ACTIONS } from "@/lib/security/audit";
import { ingestBody } from "@/lib/admin/articles/schemas";

type FailedUrlIntake = Extract<UrlIntakeOutcome, { status: "failed" }>;

function intakeError(outcome: FailedUrlIntake): ApiError {
  if (outcome.failure === "extract") {
    return new ApiError(
      422,
      "Could not extract article content from that URL (body too short or unsupported format).",
    );
  }
  const prefix = outcome.failure === "save" ? "Save failed" : "Scrape failed";
  return new ApiError(422, `${prefix}: ${outcome.reason}`);
}

async function duplicateArticleResponse(sourceUrl: string): Promise<NextResponse> {
  const existing = await findPublicLibraryArticleBySourceUrl(sourceUrl);
  return NextResponse.json(
    {
      status: "duplicate",
      id: existing?.id ?? null,
      message: "An article from this URL already exists.",
    },
    { status: 409 },
  );
}

/**
 * Scrapes a single URL and saves it as a draft article. Returns the new
 * article id on success, or throws an ApiError on scrape failure / duplicate.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { body: ingestBody },
  async ({ req, body, session, requestId }) => {
    const outcome = await scrapeAndSave(body.url, (created) => ({
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
      return duplicateArticleResponse(outcome.sourceUrl);
    }

    if (outcome.status === "failed") {
      throw intakeError(outcome);
    }

    revalidateArticlesCache();
    return NextResponse.json(
      { status: "saved", id: outcome.id },
      { status: 201 },
    );
  },
);
