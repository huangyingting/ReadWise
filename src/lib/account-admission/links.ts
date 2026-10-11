import { envValue } from "@/lib/runtime-config/env";

const PUBLIC_APP_URL_ENVS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_SITE_URL",
] as const;

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function accountAdmissionPublicOrigin(
  requestUrl?: string,
): string | null {
  for (const name of PUBLIC_APP_URL_ENVS) {
    const value = envValue(name);
    const origin = value ? httpOrigin(value) : null;
    if (origin) return origin;
  }
  return requestUrl ? httpOrigin(requestUrl) : null;
}

export function accountAdmissionSecretLink(
  path: string,
  token: string,
  requestUrl?: string,
): string | null {
  const origin = accountAdmissionPublicOrigin(requestUrl);
  return origin
    ? new URL(`${path}/${encodeURIComponent(token)}`, origin).toString()
    : null;
}
