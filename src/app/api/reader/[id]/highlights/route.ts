import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import {
  listHighlights,
  createHighlight,
  annotateHighlightAnchors,
} from "@/lib/annotations";
import type { HighlightColor } from "@/lib/annotations";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { createHighlightBody } from "@/lib/reader/schemas";

export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);
    const highlights = await listHighlights(session.user.id, params.id);
    // RW-043 — flag highlights whose anchor no longer matches the current
    // content as stale (revalidation), without dropping any.
    const plainText = articleHtmlToReaderText(article.content ?? "");
    const annotated = annotateHighlightAnchors(highlights, plainText);
    return NextResponse.json({ highlights: annotated });
  },
);

export const POST = createHandler(
  { params: idParams, body: createHighlightBody },
  async ({ params, body, session }) => {
    await requireReadableArticle(params.id, session.user);

    const result = await createHighlight(session.user.id, params.id, {
      quote: body.quote,
      startOffset: body.startOffset,
      endOffset: body.endOffset,
      prefix: body.prefix,
      suffix: body.suffix,
      note: body.note,
      color: body.color as HighlightColor | undefined,
    });

    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    return NextResponse.json({ highlight: result.highlight }, { status: 201 });
  },
);
