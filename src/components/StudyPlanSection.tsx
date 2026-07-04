import Link from "next/link";
import { Target, ArrowRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui";
import type { StudyPlan, StudyPlanHistoryEntry } from "@/lib/learning/study-plan";

type StudyPlanItem = StudyPlan["items"][number];

function StudyPlanHeader({ summary }: { summary: string }) {
  return (
    <>
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
        {summary}
      </p>
    </>
  );
}

function WeakAreaBadges({ weakAreas }: { weakAreas: StudyPlan["weakAreas"] }) {
  if (weakAreas.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-[var(--space-2)] mb-[var(--space-4)]">
      {weakAreas.slice(0, 4).map((area) => (
        <Badge key={area.kind} variant="neutral" title={area.detail}>
          {area.label}
        </Badge>
      ))}
    </div>
  );
}

function StudyPlanCard({ item }: { item: StudyPlanItem }) {
  return (
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
  );
}

function formatWeekRange(entry: Pick<StudyPlanHistoryEntry, "weekStart" | "weekEnd">): string {
  if (!entry.weekStart || !entry.weekEnd) return "Saved plan";
  const start = new Date(entry.weekStart);
  const end = new Date(entry.weekEnd);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function StudyPlanHistory({ history }: { history: StudyPlanHistoryEntry[] }) {
  if (history.length === 0) return null;

  return (
    <div className="mt-[var(--space-5)]">
      <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text m-0 mb-[var(--space-2)]">
        Plan history
      </h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-2)]">
        {history.map((entry) => (
          <li key={entry.id}>
            <Card className="p-[var(--space-3)]">
              <div className="flex flex-col gap-[var(--space-1)] sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[length:var(--text-sm)] font-medium text-text">
                  {formatWeekRange(entry)}
                </span>
                <span className="text-[length:var(--text-sm)] text-text-muted">
                  {entry.isStarter ? "Starter plan" : `${entry.weakAreas.length} focus area${entry.weakAreas.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <p className="text-[length:var(--text-sm)] text-text-muted m-0 mt-[var(--space-1)]">
                {entry.summary}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders the learner's weakness diagnostics + weekly study plan (RW-041).
 * Presentational server component — the {@link StudyPlan} is computed by the
 * page via `generateStudyPlan` and passed in. Grounds every item in recorded
 * activity and links to the concrete next action.
 */
export default function StudyPlanSection({
  plan,
  history = [],
}: {
  plan: StudyPlan;
  history?: StudyPlanHistoryEntry[];
}) {
  return (
    <section aria-labelledby="study-plan-h" className="mt-[var(--space-7)]">
      <StudyPlanHeader summary={plan.summary} />

      {/* Weak areas — only shown when grounded in activity. */}
      <WeakAreaBadges weakAreas={plan.weakAreas} />

      <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-3)]">
        {plan.items.map((item) => (
          <li key={item.id}>
            <StudyPlanCard item={item} />
          </li>
        ))}
      </ul>
      <StudyPlanHistory history={history} />
    </section>
  );
}
