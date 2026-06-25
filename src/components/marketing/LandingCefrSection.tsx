/**
 * LandingCefrSection — "For every learner, at every level" CEFR badge grid
 * (REF-059).
 */
import { CefrBadge } from "@/components/ui";
import { Reveal } from "@/components/marketing/Reveal";
import { CONTAINER, LEVELS } from "@/components/marketing/landing-content";

export function LandingCefrSection() {
  return (
    <section className="bg-bg py-[var(--space-11)]">
      <div className={CONTAINER}>
        <Reveal className="mx-auto max-w-[56ch] text-center">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
            For every learner, at every level
          </h2>
          <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
            Whether you&apos;re decoding your first English newspaper or
            polishing C1 business writing, ReadWise meets you exactly where you
            are.
          </p>
        </Reveal>

        <ul className="mt-[var(--space-9)] flex flex-wrap justify-center gap-[var(--space-5)]">
          {LEVELS.map(({ level, phrase }, i) => (
            <Reveal
              key={level}
              className="flex flex-col items-center gap-[var(--space-2)]"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <CefrBadge level={level} />
              <span className="text-[length:var(--text-sm)] text-text-subtle">
                {phrase}
              </span>
            </Reveal>
          ))}
        </ul>

        <Reveal className="mx-auto mt-[var(--space-7)] max-w-[56ch] text-center">
          <p className="text-[length:var(--text-base)] text-text-muted">
            During onboarding, you tell ReadWise your current level and the
            topics you care about. The app filters and sorts every article so
            the right content finds you — not the other way around. Reassess any
            time in Settings.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
