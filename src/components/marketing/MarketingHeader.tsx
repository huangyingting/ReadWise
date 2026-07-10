import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { WordmarkLink } from "@/components/Wordmark";
import { focusRing } from "@/lib/cn";

export interface MarketingHeaderProps {
  signedIn: boolean;
}

const SIGNED_IN_CTA = (
  <>
    Dashboard <span aria-hidden="true">→</span>
  </>
);

/**
 * Glassmorphic sticky marketing header — wordmark + theme toggle + auth-aware
 * CTA. Standalone (not the M2 app shell); contains no collapsible nav, so it
 * needs no hamburger on mobile.
 */
export function MarketingHeader({ signedIn }: MarketingHeaderProps) {
  const ctaHref = signedIn ? "/dashboard" : "/signin";
  const ctaLabel = signedIn ? SIGNED_IN_CTA : "Sign In";

  return (
    <header
      className="sticky top-0 z-[var(--z-overlay)] border-b border-border [background:color-mix(in_srgb,var(--surface)_85%,transparent)] [backdrop-filter:blur(12px)]"
    >
      <a
        href="#main-content"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-[var(--space-4)] focus:top-[var(--space-3)] focus:z-[var(--z-skip)] focus:rounded-[var(--radius-md)] focus:bg-surface focus:px-[var(--space-4)] focus:py-[var(--space-2)] focus:text-text focus:shadow-[var(--shadow-md)] ${focusRing}`}
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-[var(--marketing-header-h)] max-w-[var(--marketing-container-w)] items-center justify-between gap-[var(--space-4)] px-[clamp(var(--space-6),5vw,var(--space-8))]">
        <WordmarkLink href="/" ariaLabel="ReadWise home" size="marketing" />
        <div className="flex items-center gap-[var(--space-2)] sm:gap-[var(--space-3)]">
          <ThemeToggle />
          <Link
            href={ctaHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
