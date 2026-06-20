import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { Wordmark } from "./Wordmark";

export interface MarketingHeaderProps {
  signedIn: boolean;
}

/**
 * Glassmorphic sticky marketing header — wordmark + theme toggle + auth-aware
 * CTA. Standalone (not the M2 app shell); contains no collapsible nav, so it
 * needs no hamburger on mobile.
 */
export function MarketingHeader({ signedIn }: MarketingHeaderProps) {
  return (
    <header
      className="sticky top-0 z-50 border-b border-border [background:color-mix(in_srgb,var(--surface)_85%,transparent)] [backdrop-filter:blur(12px)]"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-[var(--space-4)] focus:top-[var(--space-3)] focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-surface focus:px-[var(--space-4)] focus:py-[var(--space-2)] focus:text-text focus:shadow-[var(--shadow-md)] focus:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-[var(--space-4)] px-[clamp(var(--space-6),5vw,var(--space-8))]">
        <Wordmark />
        <div className="flex items-center gap-[var(--space-2)] sm:gap-[var(--space-3)]">
          <ThemeToggle />
          <Link
            href={signedIn ? "/dashboard" : "/signin"}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {signedIn ? <>Dashboard <span aria-hidden="true">→</span></> : "Sign In"}
          </Link>
        </div>
      </div>
    </header>
  );
}
