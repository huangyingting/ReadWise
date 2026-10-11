import { NextResponse } from "next/server";
import { createPublicHandler, ApiError } from "@/lib/api-handler";
import { object, string } from "@/lib/validation";
import {
  authenticatePassword,
  enforceAccountAdmissionRateLimit,
} from "@/lib/account-admission";
import { setDatabaseSessionCookie } from "@/lib/auth/session-cookie";

const loginBody = object({
  email: string({ min: 3, max: 320 }),
  password: string({ min: 1, max: 128, trim: false }),
});

export const POST = createPublicHandler(
  { body: loginBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req, body.email);
    const result = await authenticatePassword(body);
    if (!result) {
      throw new ApiError(401, "Email or password is incorrect.");
    }
    const response = NextResponse.json({ ok: true });
    setDatabaseSessionCookie(response, result.session);
    return response;
  },
);
