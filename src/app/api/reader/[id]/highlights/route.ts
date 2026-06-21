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
  HIGHLIGHT_COLORS,
  HIGHLIGHT_NOTE_MAX,
} from "@/lib/highlights";
import type { HighlightColor } from "@/lib/highlights";
import { getViewableArticleById } from "@/lib/articles";

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
    const article = await getViewableArticleById(params.id, session.user.role, session.user.id);
    if (!article) {
      throw new ApiError(404, "Article not found");
    }
    const highlights = await listHighlights(session.user.id, params.id);
    return NextResponse.json({ highlights });
  },
);

export const POST = createHandler(
  { params: idParams, body: createBody },
  async ({ params, body, session }) => {
    const article = await getViewableArticleById(params.id, session.user.role, session.user.id);
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

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
