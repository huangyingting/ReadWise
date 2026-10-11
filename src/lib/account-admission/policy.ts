export const ACCOUNT_ADMISSION_MODES = ["invitation-only", "public"] as const;
export type AccountAdmissionMode = (typeof ACCOUNT_ADMISSION_MODES)[number];

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidAccountEmail(email: string): boolean {
  const normalized = normalizeAccountEmail(email);
  const separator = normalized.indexOf("@");
  return (
    normalized.length <= 320 &&
    separator > 0 &&
    separator === normalized.lastIndexOf("@") &&
    separator < normalized.length - 1 &&
    !/\s/.test(normalized)
  );
}

export function accountAdmissionMode(): AccountAdmissionMode {
  const configured = process.env.ACCOUNT_ADMISSION_MODE?.trim().toLowerCase();
  return configured === "public" || configured === "invitation-only"
    ? configured
    : "invitation-only";
}

function profileRecord(profile: unknown): Record<string, unknown> | null {
  return typeof profile === "object" && profile !== null
    ? (profile as Record<string, unknown>)
    : null;
}

export function verifiedProviderEmail(
  provider: string,
  profile: unknown,
): string | null {
  const record = profileRecord(profile);
  if (!record || typeof record.email !== "string") return null;

  if (provider === "google" && record.email_verified !== true) return null;
  if (provider === "azure-ad" && typeof record.sub !== "string") return null;
  if (provider !== "google" && provider !== "azure-ad") return null;

  const email = normalizeAccountEmail(record.email);
  return email || null;
}
