/**
 * MasteryWidget — server component for the dashboard "Your progress" band.
 *
 * Renders a teal average-score ring (same geometry as DailyGoal), a Sparkline
 * of recentTrend, and a sub-stat row. Empty state when totalAttempts === 0.
 *
 * Feed via getQuizMastery(userId) on the dashboard page.
 * Pass className="md:col-span-2 lg:col-span-1" from the grid parent so the
 * card spans the full md row and drops back to a single column at lg.
 */

import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import Sparkline from "@/components/Sparkline";
import type { QuizMastery } from "@/lib/learning/quiz-mastery";

interface MasteryWidgetProps {
  mastery: QuizMastery;
  /** Grid col-span utility classes injected by the parent grid. */
  className?: string;
}

/** Ring geometry — mirrors DailyGoal: 72×72 viewBox, r=28, strokeWidth=8. */
const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R; // ≈ 175.93

export default function MasteryWidget({ mastery, className }: MasteryWidgetProps) {
  const { totalAttempts, articlesQuizzed, averageScore, recentTrend } = mastery;
  const isEmpty = totalAttempts === 0;

  // Sparkline values + accessible label
  const sparkValues = recentTrend.map((p) => p.scorePct);
  const trendDir =
    sparkValues.length >= 2
      ? sparkValues[sparkValues.length - 1] > sparkValues[0]
        ? " Trending up."
        : sparkValues[sparkValues.length - 1] < sparkValues[0]
          ? " Trending down."
          : " Steady."
      : "";
  const sparkLabel = `Recent quiz scores, oldest to newest: ${sparkValues.join(", ")} percent.${trendDir}`;

  // Ring progress
  const avg = averageScore ?? 0;
  const progress = avg / 100;
  const ringOffset = RING_C * (1 - progress);

  return (
    <Card className={cn(className)}>
      {/* Title — matches Streak/Goal heading style */}
      <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] uppercase tracking-wide text-text-subtle m-0">
        Comprehension
      </h3>

      {isEmpty ? (
        /* ── Empty state: inline card variant (M4 EmptyState voice) ── */
        <div className="flex flex-col items-center text-center gap-[var(--space-3)] py-[var(--space-6)]">
          <div
            className="inline-flex items-center justify-center h-12 w-12 rounded-[var(--radius-full)] bg-bg-subtle border border-border text-text-subtle"
            aria-hidden
          >
            <GraduationCap size={24} />
          </div>
          <p className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-base)] text-text m-0">
            No quizzes yet
          </p>
          <p className="text-text-muted text-[length:var(--text-sm)] max-w-[32ch] m-0">
            Take a quiz after reading to track your comprehension.
          </p>
          <Link
            href="/browse"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Browse articles
          </Link>
        </div>
      ) : (
        /* ── Mastery content ── */
        <div style={{ marginTop: "var(--space-3)" }}>
          {/*
            Ring + sparkline row:
            - Mobile: column (ring then sparkline below)
            - md (card is col-span-2): row (ring left, sparkline fills right)
            - lg (card is col-span-1): column again
          */}
          <div className="flex flex-col gap-[var(--space-3)] md:flex-row md:items-center md:gap-[var(--space-4)] lg:flex-col lg:items-start">
            {/* Average ring */}
            <div
              role="img"
              aria-label={`Average comprehension ${avg}% across ${totalAttempts} attempt${totalAttempts === 1 ? "" : "s"}`}
              className="relative shrink-0 w-16 h-16 sm:w-[72px] sm:h-[72px]"
            >
              <svg
                viewBox="0 0 72 72"
                className="w-full h-full -rotate-90"
                aria-hidden
              >
                {/* Track */}
                <circle
                  cx="36"
                  cy="36"
                  r={RING_R}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {/* Progress arc — always teal (no success flip; teal IS comprehension hue) */}
                <circle
                  cx="36"
                  cy="36"
                  r={RING_R}
                  fill="none"
                  stroke="var(--teal)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              {/* Center label */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                aria-hidden
              >
                <span className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-text leading-none">
                  {avg}
                  <span className="text-[length:var(--text-sm)] text-text-muted">%</span>
                </span>
              </div>
            </div>

            {/* Sparkline — fills remaining space on wide layouts */}
            {sparkValues.length > 0 && (
              <div className="flex-1 min-w-0 w-full">
                <Sparkline values={sparkValues} label={sparkLabel} height={40} />
              </div>
            )}
          </div>

          {/* Sub-stat row — mirrors Streak "Longest: N days" */}
          <p
            className="flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-text-muted m-0"
            style={{ marginTop: "var(--space-4)" }}
          >
            <GraduationCap
              size={14}
              className="text-text-subtle shrink-0"
              aria-hidden
            />
            {articlesQuizzed} article{articlesQuizzed === 1 ? "" : "s"} quizzed
            {" · "}
            {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </Card>
  );
}
