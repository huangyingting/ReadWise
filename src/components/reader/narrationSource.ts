/**
 * Narration source order for the Reader: try the preferred engine, then the
 * other one, so readers get audio whenever either source can provide it.
 *
 * Each attempt resolves `true` when it handed playable narration to the
 * player and `false` when its source has nothing (e.g. no stored cloud
 * audio). A cloud request error does not stop the on-device attempt; it is
 * rethrown only if on-device also produced nothing, so the Reader can offer a
 * retry instead of marking narration unavailable.
 */
import type { NarrationEngine } from "@/lib/reader-prefs";

export type NarrationAttempt = () => Promise<boolean>;

export async function loadNarrationSource(
  preferred: NarrationEngine,
  attempts: Record<NarrationEngine, NarrationAttempt>,
): Promise<NarrationEngine | null> {
  const order: NarrationEngine[] = preferred === "device" ? ["device", "cloud"] : ["cloud", "device"];
  let cloudError: unknown = null;
  for (const engine of order) {
    try {
      if (await attempts[engine]()) return engine;
    } catch (err) {
      if (engine !== "cloud") throw err;
      cloudError = err;
    }
  }
  if (cloudError) throw cloudError;
  return null;
}
