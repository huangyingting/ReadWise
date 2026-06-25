/**
 * LandingHowItWorksSection — four-step "How It Works" stepper (REF-059).
 */
import { StepCard } from "@/components/marketing/StepCard";
import { Reveal } from "@/components/marketing/Reveal";
import { CONTAINER, STEPS } from "@/components/marketing/landing-content";

export function LandingHowItWorksSection() {
  return (
    <section className="bg-bg-subtle py-[var(--space-12)]">
      <div className={CONTAINER}>
        <Reveal className="mx-auto max-w-[56ch] text-center">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
            From article to fluency in four steps
          </h2>
          <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
            ReadWise structures every session so you always know what to do
            next.
          </p>
        </Reveal>

        <div className="mt-[var(--space-9)] flex flex-col gap-[var(--space-7)] lg:flex-row lg:gap-[var(--space-6)]">
          {STEPS.map((s, i) => (
            <Reveal
              key={s.step}
              className="flex flex-1"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <StepCard
                step={s.step}
                icon={<s.Icon size={s.iconSize} />}
                title={s.title}
                body={s.body}
                isLast={i === STEPS.length - 1}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
