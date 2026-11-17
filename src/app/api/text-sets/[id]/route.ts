import { NextResponse } from "next/server";
import { ApiError, createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteTextSet, getTextSetForViewer, updateTextSet } from "@/lib/classroom/text-sets";
import { textSetError, updateTextSetBody } from "@/lib/classroom/text-set-schemas";
import { textSetAudit } from "@/lib/classroom/text-set-audit";

/** A text set the viewer may see (404 otherwise — cross-org sets are invisible). */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const textSet = await getTextSetForViewer(params.id, session.user);
  if (!textSet) throw new ApiError(404, "Text set not found");
  return NextResponse.json({ textSet });
});

/** Replaces the set's fields and ordered items. Owner, or org admin for shared sets. Audited. */
export const PATCH = createHandler(
  { params: idParams, body: updateTextSetBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await updateTextSet(params.id, session.user, body, textSetAudit({ req, session, requestId }));
    if (!result.ok) throw textSetError(result);
    return NextResponse.json({ ok: true });
  },
);

/** Deletes the set; linked assignments stay but lose their unit link. Audited. */
export const DELETE = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await deleteTextSet(params.id, session.user, textSetAudit({ req, session, requestId }));
  if (!result.ok) throw textSetError(result);
  return NextResponse.json({ ok: true });
});
