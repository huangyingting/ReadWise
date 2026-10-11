import { createHash } from "node:crypto";
import {
  checkRateLimitByKey,
  clientIpKey,
} from "@/lib/security/rate-limit";
import { normalizeAccountEmail } from "./policy";

function emailRateLimitKey(email: string): string {
  const digest = createHash("sha256")
    .update(normalizeAccountEmail(email))
    .digest("base64url");
  return `email:${digest}`;
}

export async function enforceAccountAdmissionRateLimit(
  req: Request,
  email?: string,
): Promise<void> {
  await checkRateLimitByKey(clientIpKey(req), "auth");
  if (email) {
    await checkRateLimitByKey(emailRateLimitKey(email), "auth");
  }
}
