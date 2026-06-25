import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, string, optional } from "@/lib/validation";
import { updateHighlight, deleteHighlight, HIGHLIGHT_NOTE_MAX } from "@/lib/annotations";

const patchBody = object({
  note: optional(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: optional(string({ max: 20 })),
  // RW-043 — the updatedAt the offline client last saw, for conflict-aware
  // note merging (both versions preserved when the server note changed).
  baseUpdatedAt: optional(string({ max: 40 })),
});

export const PATCH = createHandler(
  { params: idParams, body: patchBody },
  async ({ params, body, session }) => {
    const result = await updateHighlight(params.id, session.user.id, {
      note: body.note,
      color: body.color,
      baseUpdatedAt: body.baseUpdatedAt,
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ highlight: result.highlight, conflict: result.conflict });
  },
);

export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await deleteHighlight(params.id, session.user.id);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ ok: true });
  },
);
