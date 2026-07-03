import { createHash } from "node:crypto";

const DEFAULT_MIME_EXTENSION = ".bin";
const DEFAULT_KEY_HINT = "media";
const MIME_EXTENSION_BY_TYPE = new Map<string, string>([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/opus", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/webm", ".webm"],
]);

/** Lowercase hex sha-256 of a buffer. */
export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function extensionForMime(mimeType: string): string {
  return MIME_EXTENSION_BY_TYPE.get(mimeType.toLowerCase()) ?? DEFAULT_MIME_EXTENSION;
}

export function normalizeExtension(ext: string | undefined): string | null {
  if (!ext) return null;
  const trimmed = ext.trim().toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

/** Strips path-traversal and unsafe characters from a key-prefix hint. */
export function sanitizeKeyHint(hint: string | undefined): string {
  if (!hint) return DEFAULT_KEY_HINT;
  const cleaned = hint
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\.{2,}/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  return cleaned || DEFAULT_KEY_HINT;
}
