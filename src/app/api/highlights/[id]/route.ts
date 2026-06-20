import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, string, optional } from "@/lib/validation";
import { updateHighlight, deleteHighlight, HIGHLIGHT_NOTE_MAX } from "@/lib/highlights";

const patchBody = object({
  note: optional(string({ max: HIGHLIGHT_NOTE_MAX })),
  color: optional(string({ max: 20 })),
});

export const PATCH = createHandler(
  { params: idParams, body: patchBody },
  async ({ params, body, session }) => {
    const result = await updateHighlight(params.id, session.user.id, {
      note: body.note,
      color: body.color,
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ highlight: result.highlight });
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
