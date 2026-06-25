import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { GoalMetIcon } from "@/components/GoalMetIcon";
import type { StreakSummary } from "@/lib/engagement/streak";

interface DailyGoalProps {
  streak: StreakSummary;
}

/**
 * Dashboard "Daily goal" card — server component.
 * Circular SVG progress ring (teal fill = reading-state).
 * Goal editing is M7; M6 ships read-only + "Adjust goal → Settings" ghost link.
 */
export default function DailyGoal({ streak }: DailyGoalProps) {
  const { todayProgress, dailyGoal } = streak;
  const target = dailyGoal;
  const progress = Math.min(todayProgress / Math.max(target, 1), 1);
  const met = todayProgress >= target;

  // Desktop ring: r=28, cx=cy=36, viewBox 72×72
  const r = 28;
  const C = 2 * Math.PI * r; // ≈ 175.93
  const offset = C * (1 - progress);

  return (
    <Card>
      {/* Title */}
      <h3
        className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] uppercase tracking-wide text-text-subtle m-0"
      >
        Daily goal
      </h3>

      {/* Ring + copy row */}
      <div
        className="flex items-center gap-[var(--space-4)]"
        style={{ marginTop: "var(--space-3)" }}
      >
        {/* Progress ring */}
        <div
          role="progressbar"
          aria-valuenow={todayProgress}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label="Daily reading goal"
          className="relative shrink-0 w-16 h-16 sm:w-[72px] sm:h-[72px]"
        >
          {/* SVG ring — rotated so progress starts at top */}
          <svg
            viewBox="0 0 72 72"
            className="w-full h-full -rotate-90"
            aria-hidden
          >
            {/* Track */}
            <circle
              cx="36"
              cy="36"
              r={r}
              fill="none"
              stroke="var(--border)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Progress arc */}
            <circle
              cx="36"
              cy="36"
              r={r}
              fill="none"
              stroke={met ? "var(--success)" : "var(--teal)"}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={met ? 0 : offset}
              style={{
                transition:
                  "stroke-dashoffset var(--duration-slow) var(--ease-emphasized), stroke var(--duration-base) var(--ease-standard)",
              }}
            />
          </svg>

          {/* Center label — overlaid, not rotated */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            {met ? (
              <GoalMetIcon size={24} />
            ) : (
              <span className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text leading-none">
                {todayProgress}
                <span className="text-[length:var(--text-sm)] text-text-muted">
                  /{target}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Copy block */}
        <div className="flex flex-col gap-[var(--space-1)]">
          {met ? (
            <p
              className={cn(
                "text-[length:var(--text-base)] font-semibold text-[color:var(--success-text)] m-0",
              )}
            >
              {todayProgress > target
                ? `Goal met — ${todayProgress} read today!`
                : "Goal met — nice work!"}
            </p>
          ) : (
            <p className="text-[length:var(--text-base)] text-text m-0">
              {todayProgress} of {target} article
              {target === 1 ? "" : "s"} today
            </p>
          )}

          {/* Adjust goal ghost link — read-only in M6, editing deferred to M7 */}
          <Link
            href="/settings"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            style={{ alignSelf: "flex-start" }}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Adjust goal
          </Link>
        </div>
      </div>
    </Card>
  );
}
