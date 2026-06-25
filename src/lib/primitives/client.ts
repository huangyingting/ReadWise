"use client";
/**
 * Client-only platform primitives barrel — `@/lib/primitives/client`
 *
 * @boundary client — may use DOM / Web APIs and React hooks.
 * Must NOT be imported by server components or server-only modules.
 *
 * Canonical import paths remain stable; these re-exports are provided for
 * discoverability and boundary documentation only.
 * See src/lib/primitives/README.md for the full classification.
 */

// ── Tailwind class composition and focus-ring token ──────────────────────────
export { cn, focusRing } from "@/lib/cn";

// ── Browser storage key registry and safe read/write helpers ─────────────────
export {
  type StorageKey,
  STORAGE_KEYS,
  lsGet,
  lsSet,
  lsRemove,
  ssGet,
  ssSet,
  ssRemove,
} from "@/lib/storage-keys";

// ── Security-sensitive: focus containment for overlays / modals ──────────────
export {
  type FocusTrapOptions,
  getTabbable,
  useFocusTrap,
} from "@/lib/focus-trap";

// ── Arrow-key roving tabindex navigation ─────────────────────────────────────
export {
  computeRovingIndex,
  useRovingTabindex,
} from "@/lib/use-roving-tabindex";
