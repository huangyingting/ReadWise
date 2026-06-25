/**
 * LandingSourcesSection — trust strip listing real news source names (REF-059).
 */
import { Badge } from "@/components/ui";
import { CONTAINER, SOURCES } from "@/components/marketing/landing-content";

export function LandingSourcesSection() {
  return (
    <section className="border-t border-border py-[var(--space-6)]">
      <div
        className={`${CONTAINER} flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-3)] overflow-x-auto`}
      >
        <h2 className="sr-only">Trusted sources</h2>
        <p className="italic text-[length:var(--text-sm)] text-text-subtle">
          Real articles from:
        </p>
        {SOURCES.map((name) => (
          <Badge key={name} variant="neutral">
            {name}
          </Badge>
        ))}
      </div>
    </section>
  );
}
