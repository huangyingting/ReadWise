import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { exportUserData } from "@/lib/account-lifecycle";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

export const GET = createHandler({}, async ({ req, session, requestId }) => {
  const data = await exportUserData(session.user.id, {
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.accountExport,
    targetType: "account",
    targetId: session.user.id,
    metadata: { format: "json" },
  });
  const date = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="readwise-data-export-${date}.json"`,
    },
  });
});
