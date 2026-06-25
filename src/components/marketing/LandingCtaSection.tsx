/**
 * LandingCtaSection — final call-to-action band with gradient background
 * (REF-059).
 */
import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { CONTAINER } from "@/components/marketing/landing-content";

interface LandingCtaSectionProps {
  primaryHref: string;
  primaryLabel: React.ReactNode;
}

export function LandingCtaSection({ primaryHref, primaryLabel }: LandingCtaSectionProps) {
  return (
    <section
      className="py-[var(--space-12)]"
      style={{ background: "var(--gradient-brand)" }}
    >
      <div className={`${CONTAINER} flex flex-col items-center text-center`}>
        <h2 className="mx-auto max-w-[48ch] font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[var(--leading-tight)] text-on-primary">
          Start reading. Start learning. Today.
        </h2>
        <p
          className="mx-auto mt-[var(--space-4)] max-w-[48ch] text-[length:var(--text-lg)]"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          Free to join. Real articles. An AI toolkit that grows with your
          English. No textbooks. No drills. Just reading.
        </p>
        <div className="mt-[var(--space-7)]">
          <Link
            href={primaryHref}
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
