import Link from "next/link";
import { Target, ArrowRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui";
import type { StudyPlan } from "@/lib/learning/study-plan";

/**
 * Renders the learner's weakness diagnostics + weekly study plan (RW-041).
 * Presentational server component — the {@link StudyPlan} is computed by the
 * page via `generateStudyPlan` and passed in. Grounds every item in recorded
 * activity and links to the concrete next action.
 */
export default function StudyPlanSection({ plan }: { plan: StudyPlan }) {
  return (
    <section aria-labelledby="study-plan-h" className="mt-[var(--space-7)]">
      <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)]">
        <Target size={20} aria-hidden className="text-[var(--primary-text)] shrink-0" />
        <h2
          id="study-plan-h"
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
        >
          Your weekly study plan
        </h2>
      </div>
      <p className="text-text-muted text-[length:var(--text-sm)] m-0 mb-[var(--space-4)]">
        {plan.summary}
      </p>

      {/* Weak areas — only shown when grounded in activity. */}
      {plan.weakAreas.length > 0 && (
        <div className="flex flex-wrap gap-[var(--space-2)] mb-[var(--space-4)]">
          {plan.weakAreas.slice(0, 4).map((area) => (
            <Badge key={area.kind} variant="neutral" title={area.detail}>
              {area.label}
            </Badge>
          ))}
        </div>
      )}

      <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-3)]">
        {plan.items.map((item) => (
          <li key={item.id}>
            <Card interactive className="p-[var(--space-4)]">
              <Link
                href={item.href}
                className="flex items-center gap-[var(--space-3)] no-underline"
              >
                <Sparkles size={18} aria-hidden className="text-[var(--primary-text)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[length:var(--text-sm)] font-semibold text-text m-0">
                    {item.title}
                  </p>
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0 mt-[var(--space-1)]">
                    {item.description}
                  </p>
                </div>
                <span className="flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--primary-text)] shrink-0">
                  {item.cta}
                  <ArrowRight size={14} aria-hidden />
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
