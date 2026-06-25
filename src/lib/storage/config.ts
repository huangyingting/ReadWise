import { createLogger } from "@/lib/logger";
import type { MediaStorageKind } from "@/lib/storage/types";

const log = createLogger("storage");

/** Reads the configured backend kind from the environment (defaults to database). */
export function mediaStorageKind(): MediaStorageKind {
  const raw = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "database" || raw === "db" || raw === "none") return "database";
  if (raw === "filesystem" || raw === "local" || raw === "fs") return "filesystem";
  if (raw === "s3" || raw === "azure" || raw === "r2") return raw as MediaStorageKind;
  log.warn("storage.unknown_kind", { value: raw, fallback: "database" });
  return "database";
}