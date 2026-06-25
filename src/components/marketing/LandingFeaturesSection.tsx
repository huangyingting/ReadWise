/**
 * LandingFeaturesSection — feature showcase grid (REF-059).
 */
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { Reveal } from "@/components/marketing/Reveal";
import { CONTAINER, FEATURES } from "@/components/marketing/landing-content";

export function LandingFeaturesSection() {
  return (
    <section className="py-[var(--space-12)]">
      <div className={CONTAINER}>
        <Reveal className="mx-auto max-w-[52ch] text-center">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-text">
            Everything you need to read and learn
          </h2>
          <p className="mt-[var(--space-3)] text-[length:var(--text-lg)] text-text-muted">
            One reading session. A full learning toolkit.
          </p>
        </Reveal>

        <div className="mt-[var(--space-9)] grid gap-[var(--space-6)] md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <Reveal
              key={feature.title}
              style={{ transitionDelay: `${i * 80}ms` }}
              className="h-full"
            >
              <FeatureCard
                icon={<feature.Icon size={feature.iconSize} />}
                title={feature.title}
                body={feature.body}
                features={feature.features}
                accent={feature.accent}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
