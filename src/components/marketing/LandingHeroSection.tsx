/**
 * LandingHeroSection — hero headline, sub-copy, CTA buttons, and mock reader
 * card (REF-059).
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Badge, buttonVariants } from "@/components/ui";
import { MockReaderCard } from "@/components/marketing/MockReaderCard";
import { CONTAINER } from "@/components/marketing/landing-content";

const HERO_BACKGROUND =
  "radial-gradient(ellipse 60% 60% at 70% 40%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 70%), radial-gradient(ellipse 40% 50% at 80% 80%, color-mix(in srgb, var(--teal) 8%, transparent), transparent 60%), var(--bg)";

const FADE_DELAYS = {
  badge: "0ms",
  title: "80ms",
  copy: "160ms",
  actions: "240ms",
  preview: "320ms",
} as const;

function animationDelay(delay: string): CSSProperties {
  return { animationDelay: delay };
}

interface LandingHeroSectionProps {
  primaryHref: string;
  primaryLabel: ReactNode;
  signedIn: boolean;
}

export function LandingHeroSection({
  primaryHref,
  primaryLabel,
  signedIn,
}: LandingHeroSectionProps) {
  return (
    <section
      className="relative overflow-hidden py-[var(--space-10)] md:py-[var(--space-12)]"
      style={{ background: HERO_BACKGROUND }}
    >
      <div
        className={`${CONTAINER} grid items-center gap-[var(--space-9)] lg:grid-cols-2`}
      >
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Badge
            variant="primary"
            uppercase
            className="rw-fade-up"
            style={animationDelay(FADE_DELAYS.badge)}
          >
            AI-Powered English Learning
          </Badge>

          <h1
            className="rw-fade-up text-gradient-brand mt-[var(--space-5)] font-[family-name:var(--font-display)] text-[length:clamp(var(--text-3xl),5vw,var(--text-4xl))] font-bold leading-[var(--leading-tight)]"
            style={animationDelay(FADE_DELAYS.title)}
          >
            Real news. Real English. Real progress.
          </h1>

          <p
            className="rw-fade-up mt-[var(--space-5)] max-w-[44ch] text-[length:var(--text-lg)] leading-[var(--leading-normal)] text-text-muted"
            style={animationDelay(FADE_DELAYS.copy)}
          >
            Learn English from real articles by BBC Features, National Geographic,
            Time, and more — with an AI toolkit that teaches as you read, not
            just translates.
          </p>

          <div
            className="rw-fade-up mt-[var(--space-7)] flex flex-wrap items-center justify-center gap-[var(--space-4)] lg:justify-start"
            style={animationDelay(FADE_DELAYS.actions)}
          >
            <Link
              href={primaryHref}
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              {primaryLabel}
            </Link>
            {!signedIn && (
              <Link
                href="/signin"
                className={buttonVariants({ variant: "ghost", size: "lg" })}
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        <div
          className="rw-fade-up"
          style={animationDelay(FADE_DELAYS.preview)}
        >
          <MockReaderCard />
        </div>
      </div>
    </section>
  );
}
