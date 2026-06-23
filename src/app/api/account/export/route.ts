import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { exportUserData } from "@/lib/account";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";

export const GET = createHandler({}, async ({ req, session, requestId }) => {
  const data = await exportUserData(session.user.id);
  const date = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);

  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.accountExport,
    targetType: "account",
    targetId: session.user.id,
    metadata: { format: "json" },
  });

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="readwise-data-export-${date}.json"`,
    },
  });
});
