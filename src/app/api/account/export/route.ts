import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { exportUserData } from "@/lib/account-lifecycle";
import { AUDIT_ACTIONS, type AuditRequestInput } from "@/lib/security/audit";

const EXPORT_FILENAME_PREFIX = "readwise-data-export";
const EXPORT_FILENAME_DATE_LENGTH = 10;
const EXPORT_RESPONSE_INIT = {
  status: 200,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
  },
} as const;

type AccountExportAuditContext = Pick<AuditRequestInput, "req" | "session" | "requestId"> & {
  userId: string;
};

function accountExportAudit({
  req,
  session,
  requestId,
  userId,
}: AccountExportAuditContext): AuditRequestInput {
  return {
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.accountExport,
    targetType: "account",
    targetId: userId,
    metadata: { format: "json" },
  };
}

function exportFilename(date: Date): string {
  const day = date.toISOString().slice(0, EXPORT_FILENAME_DATE_LENGTH);
  return `${EXPORT_FILENAME_PREFIX}-${day}.json`;
}

function exportJsonResponse(json: string, filename: string): NextResponse {
  return new NextResponse(json, {
    ...EXPORT_RESPONSE_INIT,
    headers: {
      ...EXPORT_RESPONSE_INIT.headers,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const GET = createHandler({}, async ({ req, session, requestId }) => {
  const userId = session.user.id;
  const data = await exportUserData(
    userId,
    accountExportAudit({ req, session, requestId, userId }),
  );
  const filename = exportFilename(new Date());
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);

  return exportJsonResponse(json, filename);
});
