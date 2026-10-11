import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  inspectAccountInvitation,
} from "@/lib/account-admission";

const invitationBody = object({
  token: string({ min: 1, max: 500, trim: false }),
});

export const POST = createPublicHandler(
  { body: invitationBody },
  async ({ req, body }) => {
    await enforceAccountAdmissionRateLimit(req);
    const invitation = await inspectAccountInvitation(body.token);
    return NextResponse.json({ invitation });
  },
);
