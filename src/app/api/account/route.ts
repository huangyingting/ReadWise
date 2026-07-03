import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { deleteOwnAccount } from "@/lib/account-lifecycle";
import { AUDIT_ACTIONS, type AuditRequestInput } from "@/lib/security/audit";

function accountDeleteAuditInput(
  req: Request,
  session: AuditRequestInput["session"],
  requestId: string,
  userId: string,
): AuditRequestInput {
  return {
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.accountDelete,
    targetType: "account",
    targetId: userId,
  };
}

export const DELETE = createHandler({}, async ({ req, session, requestId }) => {
  const result = await deleteOwnAccount(
    session.user.id,
    accountDeleteAuditInput(req, session, requestId, session.user.id),
  );

  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }

  // The User row is gone — cascade removed sessions/accounts/profile/etc.
  // The client must call signOut() to clear the cookie after this returns.
  return new NextResponse(null, { status: 204 });
});
