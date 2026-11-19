import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of `Authorization: Bearer <secret>` for machine-to-machine
 * routes (scheduled workers). Never logs or echoes the received header.
 */
export function hasValidBearerToken(request: Request, secret: string): boolean {
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
