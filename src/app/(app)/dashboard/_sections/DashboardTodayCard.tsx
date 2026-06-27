/**
 * DashboardTodayCard — compact secondary entry point to the Today workflow
 * (#798). Renders near the top of the Dashboard so the overview still points
 * learners back to their focused daily task without duplicating the workflow.
 *
 * Privacy: the primary article title is shown only when the Today view model
 * already resolved it through the access-checked readable where-clause, so a
 * private/imported title never leaks here.
 */
import Link from "next/link";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { Badge, Card, Inline, Stack } from "@/components/ui";
import { buttonVariants } from "@/components/ui/Button";
import type { TodayViewModel } from "@/lib/engagement/today-session";

interface DashboardTodayCardProps {
  today: TodayViewModel;
}

function statusBadge(today: TodayViewModel) {
  if (today.status === "completed") return <Badge variant="success">Complete</Badge>;
  if (today.status === "skipped") return <Badge variant="neutral">Skipped</Badge>;
  if (today.completionTier !== "none") return <Badge variant="primary">In progress</Badge>;
  return <Badge variant="primary">Ready</Badge>;
}

/** One-line "what's next" summary derived from the step tracker. */
function nextStepLabel(today: TodayViewModel): string {
  if (today.status === "completed") return "You finished today's reading task.";
  if (today.status === "skipped") return "You skipped today — browse for another read.";
  if (today.isNoCandidate || !today.primaryReadable) {
    return "Browse or import an article to start today.";
  }
  if (today.steps.reading.state !== "complete") return "Next: read today's article.";
  if (today.steps.comprehension.state !== "complete") return "Next: check your comprehension.";
  if (today.steps.wordReview.state === "available") return "Next: review your saved words.";
  return "You're almost done for today.";
}

export function DashboardTodayCard({ today }: DashboardTodayCardProps) {
  return (
    <section aria-label="Today" className="mt-[var(--space-5)]">
      <Card>
        <Stack gap="3">
          <Inline gap="2" align="center" justify="between">
            <Inline gap="2" align="center">
              <CalendarCheck size={18} aria-hidden className="text-text-muted" />
              <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text">
                Today
              </h2>
            </Inline>
            {statusBadge(today)}
          </Inline>

          {today.primaryReadable && today.primaryArticle ? (
            <p className="m-0 text-[length:var(--text-base)] text-text">
              {today.primaryArticle.title}
            </p>
          ) : null}

          <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
            {nextStepLabel(today)}
          </p>

          <div>
            <Link
              href="/today"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Go to Today
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </Stack>
      </Card>
    </section>
  );
}
