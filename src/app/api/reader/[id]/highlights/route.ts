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
import { nullable, number, object, string } from "@/lib/validation";
import { levelQuery, parseLevelParam, requireArticleLevel } from "@/lib/article-levels/http";

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

const anchorDeleteQuery = (params: URLSearchParams) => {
  const level = parseLevelParam(params);
  if (!level.ok) return level;
  const { level: _level, ...rest } = Object.fromEntries(params);
  const anchor = object(anchorIdentity)(rest);
  return anchor.ok ? { ok: true as const, value: { ...anchor.value, level: level.value } } : anchor;
};

function highlightInputFromBody(
  body: CreateHighlightBody,
  levelKey: string,
): Parameters<typeof createHighlight>[2] {
  return {
    levelKey,
    quote: body.quote,
    startOffset: body.startOffset,
    endOffset: body.endOffset,
    prefix: body.prefix,
    suffix: body.suffix,
    note: body.note,
    color: body.color as HighlightColor | undefined,
  };
}

/**
 * Highlights are scoped to a reading level (#1303): `?level=` selects the
 * adapted variant whose text the offsets index (absent = the original text).
 */
export const GET = createHandler(
  { params: idParams, query: levelQuery },
  async ({ params, query, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);
    const variant = await requireArticleLevel(article.id, query.level);
    const highlights = await listHighlights(session.user.id, params.id, query.level);
    // RW-043 — flag highlights whose anchor no longer matches the current
    // content as stale (revalidation), without dropping any.
    const plainText = articleHtmlToReaderText(variant?.content ?? article.content ?? "");
    const annotated = annotateHighlightAnchors(highlights, plainText);
    return NextResponse.json({ highlights: annotated });
  },
);

export const POST = createHandler(
  { params: idParams, body: createHighlightBody, query: levelQuery },
  async ({ params, body, query, session }) => {
    await requireReadableArticle(params.id, session.user);
    await requireArticleLevel(params.id, query.level);

    const result = await createHighlight(
      session.user.id,
      params.id,
      highlightInputFromBody(body, query.level),
    );

    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    return NextResponse.json({ highlight: result.highlight }, { status: 201 });
  },
);

export const PATCH = createHandler(
  { params: idParams, body: anchorPatchBody, query: levelQuery },
  async ({ params, body, query, session }) => {
    const input: Parameters<typeof updateHighlightByAnchor>[3] = {};
    if (body.note !== undefined) input.note = body.note;
    if (body.color !== undefined) input.color = body.color;
    if (body.baseNote !== undefined) input.baseNote = body.baseNote;
    const result = await updateHighlightByAnchor(
      session.user.id,
      params.id,
      { startOffset: body.startOffset, endOffset: body.endOffset, levelKey: query.level },
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
      { startOffset: query.startOffset, endOffset: query.endOffset, levelKey: query.level },
    );
    return NextResponse.json({ ok: true });
  },
);
