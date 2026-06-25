import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  idParams,
  object,
  nonEmptyString,
  string,
  number,
  optional,
} from "@/lib/validation";
import {
  listHighlights,
  createHighlight,
  annotateHighlightAnchors,
  HIGHLIGHT_NOTE_MAX,
} from "@/lib/annotations";
import type { HighlightColor } from "@/lib/annotations";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { htmlToPlainText } from "@/lib/content-pipeline";

const createBody = object({
  quote: nonEmptyString(10_000),
  startOffset: number({ int: true, min: 0, max: 10_000_000 }),
  endOffset: number({ int: true, min: 1, max: 10_000_000 }),
  prefix: optional(string({ max: 256 })),
  suffix: optional(string({ max: 256 })),
  note: optional(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: optional(nonEmptyString(20)),
});

export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);
    const highlights = await listHighlights(session.user.id, params.id);
    // RW-043 — flag highlights whose anchor no longer matches the current
    // content as stale (revalidation), without dropping any.
    const plainText = htmlToPlainText(article.content ?? "");
    const annotated = annotateHighlightAnchors(highlights, plainText);
    return NextResponse.json({ highlights: annotated });
  },
);

export const POST = createHandler(
  { params: idParams, body: createBody },
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
