import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { isSpeechConfigured } from "@/lib/speech";
import { speechConfig } from "@/lib/runtime-config/speech";
import {
  enforceRateLimitPolicy,
  sessionUserRateLimitPolicy,
} from "@/lib/security/rate-limit/index";
import { issueSpeechAuthorizationToken } from "@/lib/speech/authorization-token";

// Azure Speech SDK has Node-only native bindings.
export const runtime = "nodejs";

const SPEECH_SERVICE_UNAVAILABLE = {
  configured: true,
  error: "Speech service unavailable",
} as const;

const SPEECH_TOKEN_RATE_LIMIT = sessionUserRateLimitPolicy("lookup");

function unconfiguredResponse() {
  return NextResponse.json({ configured: false });
}

function speechServiceUnavailableResponse() {
  return NextResponse.json(SPEECH_SERVICE_UNAVAILABLE, { status: 502 });
}



/**
 * GET /api/speech/token
 *
 * Exchanges the server-held credential (AZURE_SPEECH_KEY, or the Entra
 * AZURE_AI_* identity in AZURE_SPEECH_AUTH=entra mode) for a short-lived
 * (~10 min) Speech authorization token and returns it with the region so the
 * browser Speech SDK can call `SpeechConfig.fromAuthorizationToken(token, region)`.
 *
 * Neither the key nor an Entra access token is ever sent to the client — only
 * the ephemeral, Speech-scoped token.
 *
 * Degrades gracefully: returns { configured: false } (200) when credentials
 * are absent so the client can hide the pronunciation feature rather than 500.
 */
export const GET = createHandler({}, async ({ session }) => {
  await enforceRateLimitPolicy(SPEECH_TOKEN_RATE_LIMIT, { session });
  if (!isSpeechConfigured()) {
    return unconfiguredResponse();
  }

  const cfg = speechConfig.get();
  if (!cfg) {
    return unconfiguredResponse();
  }

  let token: string;
  try {
    token = await issueSpeechAuthorizationToken(cfg);
  } catch {
    return speechServiceUnavailableResponse();
  }

  return NextResponse.json({ configured: true, token, region: cfg.region });
});
