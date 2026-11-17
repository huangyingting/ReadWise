import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { createTextSet, listTextSetsForViewer } from "@/lib/classroom/text-sets";
import { createTextSetBody, textSetError } from "@/lib/classroom/text-set-schemas";
import { textSetAudit } from "@/lib/classroom/text-set-audit";

/** The viewer's own text sets and those shared in organizations where they teach (#1308). */
export const GET = createHandler({}, async ({ session }) => {
  return NextResponse.json(await listTextSetsForViewer(session.user));
});

/** Creates a text set in an organization where the viewer teaches. Audited. */
export const POST = createHandler({ body: createTextSetBody }, async ({ req, body, session, requestId }) => {
  const { organizationId, ...input } = body;
  const result = await createTextSet(session.user, organizationId, input, textSetAudit({ req, session, requestId }));
  if (!result.ok) throw textSetError(result);
  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
});
