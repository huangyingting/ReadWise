import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { isSpeechConfigured } from "@/lib/speech";
import { checkRateLimit } from "@/lib/rate-limit";

// Azure Speech SDK has Node-only native bindings.
export const runtime = "nodejs";

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
  checkRateLimit(session.user.id, "lookup");
  if (!isSpeechConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const key = process.env.AZURE_SPEECH_KEY!;
  const region = process.env.AZURE_SPEECH_REGION!;
  const tokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;

  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
  } catch {
    return NextResponse.json(
      { configured: true, error: "Speech service unavailable" },
      { status: 502 },
    );
  }

  if (!tokenRes.ok) {
    return NextResponse.json(
      { configured: true, error: "Speech service unavailable" },
      { status: 502 },
    );
  }

  const token = await tokenRes.text();
  return NextResponse.json({ configured: true, token, region });
});
