import * as React from "react";
import { cn } from "@/lib/cn";

export interface PageShellProps {
  /**
   * Content width preset:
    *  - `"listing"` (default) — wide discovery/listing width (~1200px).
   *  - `"narrow"` — reading/settings width (~720px, matching the settings page).
   */
  variant?: "listing" | "narrow";
  /** Optional extra classes appended to the container. */
  className?: string;
  children: React.ReactNode;
}

/** Max-width per variant, kept token-adjacent to the documented page widths. */
const VARIANT_MAX_WIDTH = {
  listing: "max-w-[var(--container-listing)]",
  narrow: "max-w-[var(--container-narrow)]",
} as const;

/**
 * PageShell — the standard centered page container.
 *
 * Centers its children with `margin-inline: auto` and applies the standard
 * horizontal/vertical page padding tokens (`--space-5` inline, `--space-7`
 * block) shared by existing pages. Choose a `variant` to match the documented
 * content widths:
 *  - `"listing"` ≈ 1200px
 *  - `"narrow"` ≈ 720px (parity with the settings page)
 *
 * Renders a plain `<div>`; purely presentational and additive.
 *
 * @example
 * ```tsx
 * <PageShell variant="narrow">
 *   <PageHeader title="Settings" />
 *   ...
 * </PageShell>
 * ```
 */
export function PageShell({
  variant = "listing",
  className,
  children,
}: PageShellProps): React.ReactElement {
  return (
    <div
      className={cn(
        "mx-auto w-full px-[var(--space-5)] py-[var(--space-7)]",
        VARIANT_MAX_WIDTH[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
