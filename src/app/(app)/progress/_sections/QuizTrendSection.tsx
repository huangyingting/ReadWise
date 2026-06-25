/**
 * QuizTrendSection — sparkline of recent quiz scores; renders only when the
 * user has quiz attempts (REF-059).
 */
import { Card } from "@/components/ui/Card";
import Sparkline from "@/components/Sparkline";
import type { LearnerAnalytics } from "@/lib/analytics/learner";

interface QuizTrendSectionProps {
  quizScoreTrend: LearnerAnalytics["quizScoreTrend"];
  averageQuizScore: LearnerAnalytics["averageQuizScore"];
  totalQuizAttempts: LearnerAnalytics["totalQuizAttempts"];
  sparkLabel: string;
}

export function QuizTrendSection({
  quizScoreTrend,
  averageQuizScore,
  totalQuizAttempts,
  sparkLabel,
}: QuizTrendSectionProps) {
  if (quizScoreTrend.length === 0) return null;

  return (
    <section aria-labelledby="quiz-h">
      <h2
        id="quiz-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Quiz performance
      </h2>
      <Card>
        <div className="flex items-center gap-[var(--space-6)]">
          <div>
            <p className="text-[length:var(--text-sm)] text-text-subtle">Average score</p>
            <p className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] text-text">
              {averageQuizScore ?? "—"}
              {averageQuizScore !== null && (
                <span className="text-[length:var(--text-xl)]">%</span>
              )}
            </p>
            <p className="text-[length:var(--text-xs)] text-text-subtle">
              {totalQuizAttempts} attempt{totalQuizAttempts !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex-1">
            <figure>
              <figcaption className="sr-only">{sparkLabel}</figcaption>
              <Sparkline
                values={quizScoreTrend}
                label={sparkLabel}
                coordWidth={240}
                height={48}
                accentVar="var(--primary)"
              />
            </figure>
            <p className="text-[length:var(--text-xs)] text-text-subtle mt-1">
              Recent attempts (oldest → newest)
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
