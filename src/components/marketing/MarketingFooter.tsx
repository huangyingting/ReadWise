import ThemeToggle from "@/components/shell/ThemeToggle";
import { Wordmark } from "./Wordmark";

/**
 * Lightweight marketing footer — distinct from the M2 app shell footer. Brand
 * wordmark + minimal placeholder links + theme toggle. No sitemap columns.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-bg-subtle">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-[var(--space-4)] px-[clamp(var(--space-6),5vw,var(--space-8))] py-[var(--space-7)] text-center text-[length:var(--text-sm)] text-text-subtle md:flex-row md:justify-between md:text-left">
        <Wordmark />

        <nav className="flex items-center gap-[var(--space-4)]" aria-label="Legal">
          <a href="#" className="text-text-subtle hover:text-primary-text">
            Privacy
          </a>
          <span aria-hidden="true">·</span>
          <a href="#" className="text-text-subtle hover:text-primary-text">
            Terms
          </a>
        </nav>

        <div className="flex items-center gap-[var(--space-4)]">
          <span>© 2026 ReadWise. Built for learners, by learners.</span>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
