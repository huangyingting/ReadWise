import { createHash } from "node:crypto";

/** Lowercase hex sha-256 of a buffer. */
export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/ogg":
    case "audio/opus":
      return ".ogg";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/webm":
      return ".webm";
    default:
      return ".bin";
  }
}

export function normalizeExtension(ext: string | undefined): string | null {
  if (!ext) return null;
  const trimmed = ext.trim().toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

/** Strips path-traversal and unsafe characters from a key-prefix hint. */
export function sanitizeKeyHint(hint: string | undefined): string {
  if (!hint) return "media";
  const cleaned = hint
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\.{2,}/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  return cleaned || "media";
}