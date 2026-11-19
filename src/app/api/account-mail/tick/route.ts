import { NextResponse } from "next/server";
import { ApiError, createPublicHandler } from "@/lib/api-handler";
import {
  acknowledgeAccountMail,
  claimAccountMail,
} from "@/lib/account-admission/account-mail-outbox";
import { accountMailWorkflowConfig } from "@/lib/runtime-config/account-admission";
import { hasValidBearerToken } from "@/lib/security/request-auth";
import { readBoundedText } from "@/lib/security/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
};

const MAX_REQUEST_BYTES = 4096;

/** @api-auth bearer */
export const POST = createPublicHandler({}, async ({ req }) => {
  const config = accountMailWorkflowConfig.get();
  if (!config) {
    throw new ApiError(503, "Account mail is not configured.");
  }
  if (!hasValidBearerToken(req, config.secret)) {
    throw new ApiError(401, "Unauthorized");
  }
  if (new URL(req.url).searchParams.get("check") === "1") {
    return NextResponse.json(
      {
        transport: "github-actions",
        configured: true,
        emailSent: false,
      },
      { headers: NO_STORE_HEADERS },
    );
  }
  const text = await readBoundedText(req, MAX_REQUEST_BYTES);
  if (text === null) {
    throw new ApiError(413, "Account mail request is too large.");
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ApiError(400, "Invalid account mail request.");
  }
  if (!input || typeof input !== "object" || !("operation" in input)) {
    throw new ApiError(400, "Invalid account mail operation.");
  }

  if (input.operation === "claim") {
    const messages = await claimAccountMail();
    return NextResponse.json(
      {
        messages: messages.map(
          ({ id, claimToken, to, subject, body }) => ({
            id,
            claimToken,
            to,
            subject,
            body,
          }),
        ),
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  if (
    input.operation !== "acknowledge" ||
    !("id" in input) ||
    typeof input.id !== "string" ||
    input.id.length > 128 ||
    !("claimToken" in input) ||
    typeof input.claimToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.claimToken) ||
    !("status" in input) ||
    (input.status !== "sent" &&
      input.status !== "failed" &&
      input.status !== "unconfirmed")
  ) {
    throw new ApiError(400, "Invalid account mail acknowledgement.");
  }

  if (
    !(await acknowledgeAccountMail(
      input.id,
      input.claimToken,
      input.status,
    ))
  ) {
    throw new ApiError(409, "The account mail claim is no longer active.");
  }
  return NextResponse.json(
    { acknowledged: true },
    { headers: NO_STORE_HEADERS },
  );
});
