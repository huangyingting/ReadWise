import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, optional, string } from "@/lib/validation";
import {
  accountAdmissionMode,
  beginPublicRegistration,
  enforceAccountAdmissionRateLimit,
  registerWithInvitation,
  sendRegistrationVerificationEmail,
} from "@/lib/account-admission";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
import { emailDeliveryConfig } from "@/lib/runtime-config/account-admission";
import { setDatabaseSessionCookie } from "@/lib/auth/session-cookie";

const registrationBody = object({
  email: string({ min: 3, max: 320 }),
  password: string({ min: 12, max: 128, trim: false }),
  name: optional(string({ min: 1, max: 120 })),
  token: optional(string({ min: 1, max: 500, trim: false })),
});

export const POST = createPublicHandler(
  { body: registrationBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req, body.email);

    if (accountAdmissionMode() === "invitation-only") {
      if (!body.token) {
        throw new AccountAdmissionError(
          403,
          "invitation_required",
          "A valid invitation is required to create an account.",
        );
      }
      const result = await registerWithInvitation({
        email: body.email,
        password: body.password,
        name: body.name,
        token: body.token,
      });
      const response = NextResponse.json({ ok: true }, { status: 201 });
      setDatabaseSessionCookie(response, result.session);
      return response;
    }

    if (!emailDeliveryConfig.isConfigured()) {
      throw new AccountAdmissionError(
        503,
        "email_unavailable",
        "Registration email delivery is unavailable.",
      );
    }
    const pending = await beginPublicRegistration(body);
    if (pending.token && pending.email) {
      await sendRegistrationVerificationEmail({
        email: pending.email,
        token: pending.token,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        message:
          "If this email can be registered, a verification link has been sent.",
      },
      { status: 202 },
    );
  },
);
