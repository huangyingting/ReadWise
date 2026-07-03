import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { isSpeechConfigured } from "@/lib/speech";
import { speechConfig } from "@/lib/runtime-config/speech";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { providerFetch } from "@/lib/http/provider-client";

// Azure Speech SDK has Node-only native bindings.
export const runtime = "nodejs";

const SPEECH_SERVICE_UNAVAILABLE = {
  configured: true,
  error: "Speech service unavailable",
} as const;

function unconfiguredResponse() {
  return NextResponse.json({ configured: false });
}

function speechServiceUnavailableResponse() {
  return NextResponse.json(SPEECH_SERVICE_UNAVAILABLE, { status: 502 });
}

function speechTokenUrl(region: string): string {
  return `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
}

async function issueSpeechToken(key: string, region: string): Promise<Response> {
  return providerFetch(
    speechTokenUrl(region),
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
    },
    { provider: "speech-token" },
  );
}

/**
 * GET /api/speech/token
 *
 * Exchanges the server-held AZURE_SPEECH_KEY for a short-lived (~10 min)
 * Azure authorization token and returns it with the region so the browser
 * Speech SDK can call `SpeechConfig.fromAuthorizationToken(token, region)`.
 *
 * The AZURE_SPEECH_KEY is NEVER sent to the client — only the ephemeral token.
 *
 * Degrades gracefully: returns { configured: false } (200) when credentials
 * are absent so the client can hide the pronunciation feature rather than 500.
 */
export const GET = createHandler({}, async ({ session }) => {
  await checkRateLimit(session.user.id, "lookup");
  if (!isSpeechConfigured()) {
    return unconfiguredResponse();
  }

  const cfg = speechConfig.get();
  if (!cfg) {
    return unconfiguredResponse();
  }
  const { key, region } = cfg;

  let tokenRes: Response;
  try {
    tokenRes = await issueSpeechToken(key, region);
  } catch {
    return speechServiceUnavailableResponse();
  }

  if (!tokenRes.ok) {
    return speechServiceUnavailableResponse();
  }

  const token = await tokenRes.text();
  return NextResponse.json({ configured: true, token, region });
});
