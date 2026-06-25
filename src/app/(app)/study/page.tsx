import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/vocabulary";
import { getReviewSummary } from "@/lib/learning/flashcards";
import { getQuizMastery } from "@/lib/learning/quiz-mastery";
import { generateStudyPlan } from "@/lib/learning/study-plan";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import Sparkline from "@/components/Sparkline";
import StudyPageShell from "@/components/StudyPageShell";
import StudyPlanSection from "@/components/StudyPlanSection";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";

export default async function StudyPage() {
  const session = await requireSession("/study");
  const [words, reviewSummary, mastery, studyPlan] = await Promise.all([
    getSavedWords(session.user.id),
    getReviewSummary(session.user.id),
    getQuizMastery(session.user.id),
    generateStudyPlan(session.user.id),
  ]);

  const { totalAttempts, articlesQuizzed, averageScore, recentTrend } = mastery;
  const hasAttempts = totalAttempts > 0;

  // Sparkline data
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

  // Ring geometry — 96×96 variant (larger for study page)
  const RING_R = 37;
  const RING_C = 2 * Math.PI * RING_R;
  const avg = averageScore ?? 0;
  const ringOffset = RING_C * (1 - avg / 100);

  return (
    <PageShell variant="listing">
      <PageHeader title="Study list" />

      {/* Actionable sections first (#212): flashcard review (N due) + saved words. */}
      <StudyPageShell
        words={words.map((w) => ({
          id: w.id,
          word: w.word,
          explanation: w.explanation,
          example: w.example,
          articleId: w.articleId,
        }))}
        initialDueCount={reviewSummary.dueCount}
      />

      {/* ── Weekly study plan (RW-041) — grounded weakness diagnostics ── */}
      <StudyPlanSection plan={studyPlan} />

      {/* ── Comprehension section (M14) — demoted below actionable items (#212) ── */}
      <section aria-labelledby="comprehension-h" className="mt-[var(--space-7)]">
        <h2
          id="comprehension-h"
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0 mb-[var(--space-4)]"
        >
          Comprehension
        </h2>

        {hasAttempts ? (
          <Card>
            <div className="flex flex-col gap-[var(--space-5)] sm:flex-row sm:items-center sm:gap-[var(--space-6)]">
              {/* Ring + stats */}
              <div className="flex items-center gap-[var(--space-4)] shrink-0">
                <div
                  role="img"
                  aria-label={`Average comprehension ${avg}% across ${totalAttempts} attempt${totalAttempts === 1 ? "" : "s"}`}
                  className="relative shrink-0"
                  style={{ width: 96, height: 96 }}
                >
                  <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90" aria-hidden>
                    <circle cx="48" cy="48" r={RING_R} fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
                    <circle
                      cx="48" cy="48" r={RING_R} fill="none"
                      stroke="var(--teal)" strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={RING_C} strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
                    <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text leading-none">
                      {avg}
                      <span className="text-[length:var(--text-sm)] text-text-muted">%</span>
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex flex-col gap-[var(--space-1)]">
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    Average score
                  </p>
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    {articlesQuizzed} article{articlesQuizzed === 1 ? "" : "s"} quizzed
                  </p>
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {/* Larger sparkline — fills remaining width */}
              {sparkValues.length > 0 && (
                <div className="flex-1 min-w-0 w-full">
                  <Sparkline values={sparkValues} label={sparkLabel} height={72} />
                </div>
              )}
            </div>
          </Card>
        ) : (
          /* No attempts yet — a compact hint rather than a large empty state, so
             the actionable sections above stay front-and-centre (esp. mobile). */
          <p className="text-text-muted text-[length:var(--text-sm)] m-0 flex items-center gap-[var(--space-2)]">
            <GraduationCap size={16} aria-hidden className="text-text-subtle shrink-0" />
            <span>
              No quizzes yet — take a quiz after reading an article to start tracking your comprehension.{" "}
              <Link href="/browse" className="text-[var(--primary-text)] hover:underline">
                Browse articles
              </Link>
              .
            </span>
          </p>
        )}
      </section>
    </PageShell>
  );
}

