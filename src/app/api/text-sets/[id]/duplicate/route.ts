import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { duplicateTextSet } from "@/lib/classroom/text-sets";
import { textSetError } from "@/lib/classroom/text-set-schemas";
import { textSetAudit } from "@/lib/classroom/text-set-audit";

/** Copies a visible text set into a private set owned by the viewer. Audited. */
export const POST = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await duplicateTextSet(params.id, session.user, textSetAudit({ req, session, requestId }));
  if (!result.ok) throw textSetError(result);
  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
});
