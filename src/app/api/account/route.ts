import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { deleteOwnAccount } from "@/lib/account-lifecycle";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

export const DELETE = createHandler({}, async ({ req, session, requestId }) => {
  const result = await deleteOwnAccount(session.user.id, {
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.accountDelete,
    targetType: "account",
    targetId: session.user.id,
  });

  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }

  // The User row is gone — cascade removed sessions/accounts/profile/etc.
  // The client must call signOut() to clear the cookie after this returns.
  return new NextResponse(null, { status: 204 });
});
