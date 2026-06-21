import * as React from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  /** Page title rendered as the `<h1>` at the standard display scale. */
  title: string;
  /** Optional supporting description rendered beneath the title. */
  description?: string;
  /** Optional actions (buttons, links) aligned to the right of the title. */
  actions?: React.ReactNode;
  /** Optional extra classes appended to the wrapping element. */
  className?: string;
}

/** Exact H1 classes used by existing pages (e.g. study/notes). */
const H1_CLASSES =
  "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text";

/**
 * PageHeader — the standard page heading block.
 *
 * Renders an `<h1>` at the shared display scale (reusing the exact classes the
 * study/notes pages use), an optional muted description paragraph, and an
 * optional right-aligned `actions` slot. Applies a consistent bottom margin via
 * spacing tokens so page chrome stays uniform.
 *
 * Purely presentational and additive.
 *
 * @example
 * ```tsx
 * <PageHeader
 *   title="My notes"
 *   description="Highlights and notes you've saved while reading."
 *   actions={<Button>New note</Button>}
 * />
 * ```
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps): React.ReactElement {
  return (
    <header className={cn("mb-[var(--space-6)]", className)}>
      <div className="flex items-start justify-between gap-[var(--space-4)]">
        <h1 className={H1_CLASSES}>{title}</h1>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-[var(--space-2)] text-[length:var(--text-base)] text-text-muted">
          {description}
        </p>
      ) : null}
    </header>
  );
}
