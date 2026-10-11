import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, string } from "@/lib/validation";
import {
  completePublicRegistration,
  enforceAccountAdmissionRateLimit,
} from "@/lib/account-admission";
import { setDatabaseSessionCookie } from "@/lib/auth/session-cookie";

const verificationBody = object({
  token: string({ min: 1, max: 500, trim: false }),
});

export const POST = createPublicHandler(
  { body: verificationBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req);
    const result = await completePublicRegistration(body.token);
    const response = NextResponse.json({ ok: true }, { status: 201 });
    setDatabaseSessionCookie(response, result.session);
    return response;
  },
);
