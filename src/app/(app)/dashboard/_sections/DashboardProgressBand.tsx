/**
 * DashboardProgressBand — streak, daily goal, mastery widgets + optional SRS
 * review CTA (REF-059).
 */
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui";
import StreakWidget from "@/components/StreakWidget";
import DailyGoal from "@/components/DailyGoal";
import MasteryWidget from "@/components/MasteryWidget";
import type { StreakSummary } from "@/lib/activity";
import type { QuizMastery } from "@/lib/learning/quiz-mastery";

interface DashboardProgressBandProps {
  streak: StreakSummary;
  mastery: QuizMastery;
  dueCount: number;
}

export function DashboardProgressBand({
  streak,
  mastery,
  dueCount,
}: DashboardProgressBandProps) {
  return (
    <section aria-labelledby="progress-h" className="mt-[var(--space-7)]">
      <h2
        id="progress-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0 mb-[var(--space-4)]"
      >
        Your progress
      </h2>

      {/* SRS review CTA — surfaced only when flashcards are due (#212) */}
      {dueCount > 0 && (
        <Card className="mb-[var(--space-5)]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-3)]">
              <span
                aria-hidden
                className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-subtle)] text-[var(--primary-text)] shrink-0"
              >
                <GraduationCap size={20} />
              </span>
              <div>
                <p className="font-semibold text-text m-0">
                  {dueCount} flashcard{dueCount === 1 ? "" : "s"} due for review
                </p>
                <p className="text-text-muted text-[length:var(--text-sm)] m-0">
                  Keep your vocabulary fresh with a quick review session.
                </p>
              </div>
            </div>
            <Link
              href="/study"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              Review {dueCount} due <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[var(--space-5)] rw-fade-up">
        <StreakWidget
          streak={streak}
          extendedToday={streak.last7Days[6]?.active === true && streak.currentStreak > 0}
        />
        <DailyGoal streak={streak} />
        <MasteryWidget mastery={mastery} className="md:col-span-2 lg:col-span-1" />
      </div>
    </section>
  );
}
