import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  resetPassword,
} from "@/lib/account-admission";

const resetPasswordBody = object({
  token: string({ min: 1, max: 500, trim: false }),
  password: string({ min: 12, max: 128, trim: false }),
});

export const POST = createPublicHandler(
  { body: resetPasswordBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req);
    await resetPassword(body);
    return NextResponse.json({ ok: true });
  },
);
