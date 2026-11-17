import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { assignTextSet } from "@/lib/classroom/text-sets";
import { assignTextSetBody, textSetError } from "@/lib/classroom/text-set-schemas";
import { textSetAudit } from "@/lib/classroom/text-set-audit";

/**
 * Assigns every article in the set to each classroom as a linked unit. All
 * classrooms must be active, in the set's organization, and managed by the
 * viewer. Audited.
 */
export const POST = createHandler(
  { params: idParams, body: assignTextSetBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await assignTextSet(params.id, session.user, body, textSetAudit({ req, session, requestId }));
    if (!result.ok) throw textSetError(result);
    return NextResponse.json(result);
  },
);
