import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import {
  listHighlights,
  createHighlight,
  updateHighlightByAnchor,
  deleteHighlightByAnchor,
  annotateHighlightAnchors,
  HIGHLIGHT_NOTE_MAX,
} from "@/lib/annotations";
import type { HighlightColor } from "@/lib/annotations";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { createHighlightBody, type CreateHighlightBody } from "@/lib/reader/schemas";
import { nullable, number, object, optional, string } from "@/lib/validation";

const anchorIdentity = {
  startOffset: number({ int: true, min: 0, max: 10_000_000 }),
  endOffset: number({ int: true, min: 1, max: 10_000_000 }),
};

const anchorPatchBody = object({
  ...anchorIdentity,
  note: nullable(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: nullable(string({ max: 20 })),
  baseNote: nullable(string({ max: HIGHLIGHT_NOTE_MAX })),
});

const anchorDeleteQuery = (params: URLSearchParams) =>
  object(anchorIdentity)(Object.fromEntries(params));

function highlightInputFromBody(
  body: CreateHighlightBody,
): Parameters<typeof createHighlight>[2] {
  return {
    quote: body.quote,
    startOffset: body.startOffset,
    endOffset: body.endOffset,
    prefix: body.prefix,
    suffix: body.suffix,
    note: body.note,
    color: body.color as HighlightColor | undefined,
  };
}

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

    const result = await createHighlight(
      session.user.id,
      params.id,
      highlightInputFromBody(body),
    );

    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    return NextResponse.json({ highlight: result.highlight }, { status: 201 });
  },
);

export const PATCH = createHandler(
  { params: idParams, body: anchorPatchBody },
  async ({ params, body, session }) => {
    const input: Parameters<typeof updateHighlightByAnchor>[3] = {};
    if (body.note !== undefined) input.note = body.note;
    if (body.color !== undefined) input.color = body.color;
    if (body.baseNote !== undefined) input.baseNote = body.baseNote;
    const result = await updateHighlightByAnchor(
      session.user.id,
      params.id,
      { startOffset: body.startOffset, endOffset: body.endOffset },
      input,
    );
    if (!result.ok) throw new ApiError(result.status, result.error);
    return NextResponse.json({
      highlight: result.highlight,
      conflict: result.conflict,
    });
  },
);

export const DELETE = createHandler(
  { params: idParams, query: anchorDeleteQuery },
  async ({ params, query, session }) => {
    await deleteHighlightByAnchor(
      session.user.id,
      params.id,
      { startOffset: query.startOffset, endOffset: query.endOffset },
    );
    return NextResponse.json({ ok: true });
  },
);
