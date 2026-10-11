import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  requestPasswordReset,
} from "@/lib/account-admission";

const forgotPasswordBody = object({
  email: string({ min: 3, max: 320 }),
});

export const POST = createPublicHandler(
  { body: forgotPasswordBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req, body.email);
    await requestPasswordReset(body.email);
    return NextResponse.json(
      {
        ok: true,
        message:
          "If a password account exists for this email, a reset link has been sent.",
      },
      { status: 202 },
    );
  },
);
