/**
 * Short-lived (~10 min) Speech authorization tokens from the Speech STS
 * endpoint, used by server-side synthesis in Entra mode and handed to the
 * browser for pronunciation practice. The token is scoped to Speech, so the
 * browser never receives an Entra access token or the resource key.
 */
import { getAiServicesAccessToken } from "@/lib/azure/ai-token";
import { providerFetch } from "@/lib/http/provider-client";
import type { SpeechConfig } from "@/lib/runtime-config/speech";

const STS_PATH = "/sts/v1.0/issueToken";

/** Key auth uses the regional STS host; Entra auth must use the custom domain. */
async function stsRequest(config: SpeechConfig): Promise<{ url: string; headers: Record<string, string> }> {
  if (config.auth === "entra") {
    return {
      url: `${config.endpoint}${STS_PATH}`,
      headers: { Authorization: `Bearer ${await getAiServicesAccessToken()}` },
    };
  }
  return {
    url: `https://${config.region}.api.cognitive.microsoft.com${STS_PATH}`,
    headers: { "Ocp-Apim-Subscription-Key": config.key },
  };
}

/** Issues a Speech authorization token. Throws on transport, auth, or HTTP failure. */
export async function issueSpeechAuthorizationToken(config: SpeechConfig): Promise<string> {
  const { url, headers } = await stsRequest(config);
  const res = await providerFetch(url, { method: "POST", headers }, { provider: "speech-token" });
  if (!res.ok) {
    throw new Error(`Speech token request failed (HTTP ${res.status})`);
  }
  return res.text();
}
