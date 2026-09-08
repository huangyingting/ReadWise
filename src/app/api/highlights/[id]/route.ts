import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, nullable, object, string, optional } from "@/lib/validation";
import { updateHighlight, deleteHighlight, HIGHLIGHT_NOTE_MAX } from "@/lib/annotations";

const patchBody = object({
  note: nullable(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: nullable(string({ max: 20 })),
  // RW-043 — the updatedAt the offline client last saw, for conflict-aware
  // note merging (both versions preserved when the server note changed).
  baseUpdatedAt: optional(string({ max: 40 })),
});

type HighlightCommandError = { ok: false; status: number; error: string };

function requireHighlightCommandOk<T extends { ok: true }>(
  result: T | HighlightCommandError,
): T {
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
  return result;
}

function highlightUpdateInput(body: {
  note?: string | null;
  color?: string | null;
  baseUpdatedAt?: string;
}): Parameters<typeof updateHighlight>[2] {
  const input: Parameters<typeof updateHighlight>[2] = {};
  if (body.note !== undefined) input.note = body.note;
  if (body.color !== undefined) input.color = body.color;
  if (body.baseUpdatedAt !== undefined) input.baseUpdatedAt = body.baseUpdatedAt;
  return input;
}

export const PATCH = createHandler(
  { params: idParams, body: patchBody },
  async ({ params, body, session }) => {
    const result = requireHighlightCommandOk(
      await updateHighlight(params.id, session.user.id, highlightUpdateInput(body)),
    );
    return NextResponse.json({ highlight: result.highlight, conflict: result.conflict });
  },
);

export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    requireHighlightCommandOk(await deleteHighlight(params.id, session.user.id));
    return NextResponse.json({ ok: true });
  },
);
