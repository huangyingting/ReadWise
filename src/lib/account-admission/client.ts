"use client";

type ErrorPayload = {
  error?: unknown;
};

export async function accountAdmissionRequest<T>(
  url: string,
  body?: Record<string, unknown>,
  method = "POST",
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "The request could not be completed.",
    );
  }
  return payload;
}
