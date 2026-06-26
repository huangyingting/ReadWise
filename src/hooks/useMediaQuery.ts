"use client";

/**
 * useMediaQuery — SSR-safe CSS media-query subscription.
 *
 * Returns `false` on the server and during the very first client render so the
 * markup matches the SSR output (avoids hydration mismatches), then updates to
 * the real `matchMedia` result after mount and on every subsequent change.
 *
 * Replaces the hand-rolled `window.matchMedia` + `useEffect` + add/remove
 * listener blocks previously inlined in ReaderControls and MockReaderCard.
 *
 * @param query A CSS media-query string, e.g. `"(min-width: 640px)"`.
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}
