import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, optional, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  listAuthenticationMethods,
  setPasswordForUser,
} from "@/lib/account-admission";

const passwordBody = object({
  currentPassword: optional(string({ min: 1, max: 128, trim: false })),
  password: string({ min: 12, max: 128, trim: false }),
});

export const GET = createHandler({}, async ({ session }) => {
  const methods = await listAuthenticationMethods(session.user.id);
  return NextResponse.json(methods);
});

export const PUT = createHandler(
  { body: passwordBody },
  async ({ req, session, body }) => {
    await enforceAccountAdmissionRateLimit(req, session.user.email ?? undefined);
    const result = await setPasswordForUser({
      userId: session.user.id,
      currentPassword: body.currentPassword,
      password: body.password,
    });
    return NextResponse.json({ ok: true, created: result.created });
  },
);
