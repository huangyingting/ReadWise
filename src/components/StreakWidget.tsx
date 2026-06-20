import { Flame, Award } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { StreakSummary } from "@/lib/activity";

const WEEKDAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface StreakWidgetProps {
  streak: StreakSummary;
  /** When true, plays the one-shot flame flicker (streak just extended). */
  extendedToday?: boolean;
}

/**
 * Dashboard "Reading streak" card — server component.
 * Shows current streak, 7-day dot row, and longest streak sub-stat.
 * Teal = reading-state achievement; no interactive indigo here.
 */
export default function StreakWidget({
  streak,
  extendedToday = false,
}: StreakWidgetProps) {
  const { currentStreak, longestStreak, last7Days } = streak;
  const isZero = currentStreak === 0;

  return (
    <Card>
      {/* Title */}
      <h3
        className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] uppercase tracking-wide text-text-subtle m-0"
      >
        Reading streak
      </h3>

      {/* Flame + count row */}
      <div
        className="flex items-center gap-[var(--space-3)]"
        style={{ marginTop: "var(--space-3)" }}
      >
        <Flame
          size={28}
          aria-hidden
          className={cn(
            isZero ? "text-text-subtle" : "text-[color:var(--text-accent)]",
            !isZero && extendedToday && "rw-flame-flicker",
          )}
        />
        <div className="flex items-baseline gap-[var(--space-2)]">
          <span className="font-[family-name:var(--font-display)] text-[length:var(--text-4xl)] font-semibold text-text leading-none">
            {currentStreak}
          </span>
          <span className="text-[length:var(--text-base)] text-text-muted leading-none">
            {isZero
              ? "Start a streak today"
              : currentStreak === 1
                ? "day streak"
                : "days"}
          </span>
        </div>
      </div>

      {isZero && (
        <p
          className="text-[length:var(--text-sm)] text-text-muted m-0"
          style={{ marginTop: "var(--space-2)" }}
        >
          Read an article to begin.
        </p>
      )}

      {/* 7-day dot row */}
      <ul
        className="flex gap-[var(--space-2)] items-end list-none m-0 p-0"
        aria-label="Last 7 days of reading activity"
        style={{ marginTop: "var(--space-3)" }}
      >
        {last7Days.map((day, i) => {
          const isToday = i === 6;
          const dateObj = new Date(day.date + "T00:00:00Z");
          const weekdayInitial = WEEKDAY_INITIALS[dateObj.getUTCDay()];
          const weekdayFull = dateObj.toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
          });
          const label = `${weekdayFull}: ${day.active ? "read" : "no reading"}`;

          return (
            <li
              key={day.date}
              className="flex flex-col items-center gap-[var(--space-1)]"
              aria-label={label}
            >
              <span
                className={cn(
                  "block h-2.5 w-2.5 rounded-full",
                  day.active
                    ? "bg-[color:var(--teal)]"
                    : "bg-transparent border border-border",
                  isToday &&
                    "outline outline-2 outline-offset-2 outline-[color:var(--text-accent)]",
                )}
              />
              {/* Weekday initial — hidden below 360px, hidden on narrow screens */}
              <span
                className="text-[length:var(--text-xs)] text-text-subtle hidden min-[360px]:block"
                aria-hidden
              >
                {weekdayInitial}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Longest streak sub-stat */}
      <p
        className="flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-text-muted m-0"
        style={{ marginTop: "var(--space-4)" }}
      >
        <Award size={14} className="text-text-subtle shrink-0" aria-hidden />
        Longest: {longestStreak}{" "}
        {longestStreak === 1 ? "day" : "days"}
      </p>
    </Card>
  );
}
