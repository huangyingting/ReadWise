import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/vocabulary";
import { getReviewSummary } from "@/lib/flashcards";
import { getQuizMastery } from "@/lib/quiz-mastery";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";
import Sparkline from "@/components/Sparkline";
import StudyPageShell from "@/components/StudyPageShell";

export default async function StudyPage() {
  const session = await requireSession("/study");
  const [words, reviewSummary, mastery] = await Promise.all([
    getSavedWords(session.user.id),
    getReviewSummary(session.user.id),
    getQuizMastery(session.user.id),
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
    <main className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "var(--space-6)" }}
      >
        Study list
      </h1>

      {/* ── Comprehension section (M14) ── */}
      <section aria-labelledby="comprehension-h" style={{ marginBottom: "var(--space-8)" }}>
        <h2
          id="comprehension-h"
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          style={{ marginBottom: "var(--space-4)" }}
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
          <EmptyState
            icon={GraduationCap}
            title="No quizzes yet"
            description="Take a quiz after reading an article to start tracking your comprehension."
            action={{ label: "Browse articles", href: "/browse" }}
          />
        )}
      </section>

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
    </main>
  );
}

