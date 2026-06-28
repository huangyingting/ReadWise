/**
 * Provider registry for the ReadWise scraper.
 *
 * Each provider lives in its own module under `src/lib/scraper/providers/`.
 * To add a new provider: create a focused module here, add it to `PROVIDERS`,
 * and add focused tests — no changes to existing provider modules needed.
 *
 * Public API:
 *   PROVIDERS         — ordered registry of all active providers
 *   getProvider       — look up a provider by key (case-insensitive)
 *   providerForUrl    — resolve the provider that owns a given URL
 *   mapSectionToCategory — category-slug mapper (used by extract pipeline)
 */
import type { Provider } from "@/lib/scraper/types";

export { mapSectionToCategory } from "./shared";

import nbc from "./nbc";
import natgeo from "./natgeo";
import time from "./time";
import huffpost from "./huffpost";
import bbc from "./bbc";
import smithsonian from "./smithsonian";
import knowable from "./knowable";
import nautilus from "./nautilus";
import technologyreview from "./technologyreview";
import noema from "./noema";
import undark from "./undark";
import bbcLearningEnglish from "./bbc-learning-english";

export const PROVIDERS: readonly Provider[] = [
  nbc,
  natgeo,
  time,
  huffpost,
  bbc,
  smithsonian,
  knowable,
  nautilus,
  technologyreview,
  noema,
  undark,
  bbcLearningEnglish,
];

export function getProvider(key: string): Provider | null {
  return PROVIDERS.find((p) => p.key === key.toLowerCase()) ?? null;
}

/** Finds the provider that owns a given URL by hostname match. */
export function providerForUrl(rawUrl: string): Provider | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const hostMatches = PROVIDERS.filter((p) =>
    p.hostnames.some((h) => h.replace(/^www\./, "") === host),
  );
  return hostMatches.find((p) => p.articleUrlPattern.test(rawUrl)) ?? hostMatches[0] ?? null;
}
