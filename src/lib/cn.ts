import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose conditional class names and resolve conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Global focus-visible ring per the Studio spec: a 2px ring-offset gap plus a
 * 2px focus ring, both token-driven. Apply to any interactive primitive.
 */
export const focusRing =
  "outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]";
