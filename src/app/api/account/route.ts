import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { deleteOwnAccount } from "@/lib/account";

export const DELETE = createHandler({}, async ({ session }) => {
  const result = await deleteOwnAccount(session.user.id);

  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }

  // The User row is gone — cascade removed sessions/accounts/profile/etc.
  // The client must call signOut() to clear the cookie after this returns.
  return new NextResponse(null, { status: 204 });
});
