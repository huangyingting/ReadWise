"use client";

/**
 * useReaderPrefs — reader display preferences hook (REF-055).
 *
 * Single place for reader preferences state: reads from localStorage on
 * mount, persists on change, computes font-scale step bounds, and provides
 * an aria-live announcement string for screen-reader feedback.
 *
 * Exposes a stable `prefs` object (never null — falls back to
 * `DEFAULT_READER_PREFS` before localStorage is read) so consumers do not
 * need to handle the pre-hydration null case.
 */

import { useState, useEffect } from "react";
import {
  getReaderPrefs,
  setReaderPrefs,
  stepFontScale,
  fontScaleLabel,
  FONT_SCALE_STEPS,
  DEFAULT_FONT_SCALE,
  type ReaderPrefs,
} from "@/lib/reader-prefs";

/** Stable SSR/hydration fallback — matches the reader's light-mode default. */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  mode: "light",
  fontScale: DEFAULT_FONT_SCALE,
  fontFamily: "serif",
  lineSpacing: "normal",
};

export interface UseReaderPrefsResult {
  /** Resolved prefs — always non-null; falls back to DEFAULT_READER_PREFS pre-mount. */
  prefs: ReaderPrefs;
  /** Latest aria-live announcement text for the font-size stepper. */
  announcement: string;
  /** Merge partial updates into prefs, persist, and apply to the reader root. */
  updatePrefs: (next: Partial<ReaderPrefs>) => void;
  /** Step font scale down one step (no-op at minimum). */
  handleScaleDown: () => void;
  /** Step font scale up one step (no-op at maximum). */
  handleScaleUp: () => void;
  /** True when font scale is already at the smallest step. */
  atMin: boolean;
  /** True when font scale is already at the largest step. */
  atMax: boolean;
}

export function useReaderPrefs(): UseReaderPrefsResult {
  const [_prefs, setPrefsState] = useState<ReaderPrefs | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Read stored prefs from localStorage — client-only, runs after mount.
  useEffect(() => {
    setPrefsState(getReaderPrefs());
  }, []);

  function announce(msg: string) {
    // Clear then re-set to ensure the live region fires even for repeated values.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(msg));
  }

  function updatePrefs(next: Partial<ReaderPrefs>) {
    if (!_prefs) return;
    const merged: ReaderPrefs = { ..._prefs, ...next };
    setPrefsState(merged);
    setReaderPrefs(merged);
  }

  function handleScaleDown() {
    if (!_prefs) return;
    const next = stepFontScale(_prefs.fontScale, "down");
    updatePrefs({ fontScale: next });
    announce(`Text size: ${fontScaleLabel(next)}`);
  }

  function handleScaleUp() {
    if (!_prefs) return;
    const next = stepFontScale(_prefs.fontScale, "up");
    updatePrefs({ fontScale: next });
    announce(`Text size: ${fontScaleLabel(next)}`);
  }

  const prefs = _prefs ?? DEFAULT_READER_PREFS;
  const scaleIdx = (FONT_SCALE_STEPS as readonly number[]).indexOf(prefs.fontScale);
  const atMin = scaleIdx === 0;
  const atMax = scaleIdx === FONT_SCALE_STEPS.length - 1;

  return { prefs, announcement, updatePrefs, handleScaleDown, handleScaleUp, atMin, atMax };
}
