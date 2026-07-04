import { requireSession } from "@/lib/session";
import { getSavedWords } from "@/lib/lexical/saved-words";
import { getReviewSummary } from "@/lib/learning/flashcards";
import { getReviewAssetSummary } from "@/lib/learning/review-assets";
import { getQuizMastery } from "@/lib/learning/quiz-mastery";
import { generateStudyPlan, getStudyPlanHistory } from "@/lib/learning/study-plan";
import { GraduationCap, Highlighter } from "lucide-react";
import Link from "next/link";
import { Card, PageHeader, PageShell, Section, Stack } from "@/components/ui";
import Sparkline from "@/components/Sparkline";
import StudyPageShell from "@/components/StudyPageShell";
import StudyPlanSection from "@/components/StudyPlanSection";

const QUIZ_RING_RADIUS = 37;
const QUIZ_RING_CIRCUMFERENCE = 2 * Math.PI * QUIZ_RING_RADIUS;

type SavedWord = Awaited<ReturnType<typeof getSavedWords>>[number];

function toStudyWord(word: SavedWord) {
  return {
    id: word.id,
    word: word.word,
    explanation: word.explanation,
    example: word.example,
    articleId: word.articleId,
  };
}

function getTrendDirection(values: number[]): string {
  if (values.length < 2) return "";

  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return " Trending up.";
  if (last < first) return " Trending down.";
  return " Steady.";
}

function getSparkLabel(values: number[]): string {
  const trendDir = getTrendDirection(values);
  return `Recent quiz scores, oldest to newest: ${values.join(", ")} percent.${trendDir}`;
}

export default async function StudyPage() {
  const session = await requireSession("/study");
  const [words, reviewSummary, reviewAssets, mastery, studyPlan] = await Promise.all([
    getSavedWords(session.user.id),
    getReviewSummary(session.user.id),
    getReviewAssetSummary(session.user.id),
    getQuizMastery(session.user.id),
    generateStudyPlan(session.user.id),
  ]);
  const studyPlanHistory = await getStudyPlanHistory(session.user.id, { limit: 6 });

  const { totalAttempts, articlesQuizzed, averageScore, recentTrend } = mastery;
  const hasAttempts = totalAttempts > 0;

  // Sparkline data
  const sparkValues = recentTrend.map((p) => p.scorePct);
  const sparkLabel = getSparkLabel(sparkValues);

  // Ring geometry — 96×96 variant (larger for study page)
  const avg = averageScore ?? 0;
  const ringOffset = QUIZ_RING_CIRCUMFERENCE * (1 - avg / 100);

  return (
    <PageShell variant="listing">
      <PageHeader title="Study list" />

      {/* Actionable sections first (#212): flashcard review (N due) + saved words. */}
      <StudyPageShell
        words={words.map(toStudyWord)}
        initialDueCount={reviewSummary.dueCount}
      />

      {/* ── Weekly study plan (RW-041) — grounded weakness diagnostics ── */}
      <StudyPlanSection plan={studyPlan} history={studyPlanHistory} />

      {/* ── Highlights & notes (#812) — aggregate, content-free counts only. ── */}
      {reviewAssets.totalHighlights > 0 && (
        <Section title="Highlights & notes" className="mt-[var(--space-7)]">
          <Card>
            <div className="flex items-start gap-[var(--space-4)]">
              <Highlighter
                size={20}
                aria-hidden
                className="text-text-subtle shrink-0 mt-[var(--space-1)]"
              />
              <div className="flex flex-wrap gap-x-[var(--space-6)] gap-y-[var(--space-3)]">
                <Stack gap="1">
                  <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text leading-none">
                    {reviewAssets.totalHighlights}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    saved passage{reviewAssets.totalHighlights === 1 ? "" : "s"}
                  </span>
                </Stack>
                <Stack gap="1">
                  <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text leading-none">
                    {reviewAssets.notedHighlights}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    with notes
                  </span>
                </Stack>
                <Stack gap="1">
                  <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text leading-none">
                    {reviewAssets.articlesWithHighlights}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    article{reviewAssets.articlesWithHighlights === 1 ? "" : "s"} highlighted
                  </span>
                </Stack>
                <Stack gap="1">
                  <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text leading-none">
                    {reviewAssets.weeklyHighlights}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-text-muted">
                    this week
                  </span>
                </Stack>
              </div>
            </div>
          </Card>
        </Section>
      )}

      {/* ── Comprehension section (M14) — demoted below actionable items (#212) ── */}
      <Section title="Comprehension" className="mt-[var(--space-7)]">
        {hasAttempts ? (
          <Card>
            <div className="flex flex-col gap-[var(--space-5)] sm:flex-row sm:items-center sm:gap-[var(--space-6)]">
              {/* Ring + stats */}
              <div className="flex items-center gap-[var(--space-4)] shrink-0">
                <div
                  role="img"
                  aria-label={`Average comprehension ${avg}% across ${totalAttempts} attempt${totalAttempts === 1 ? "" : "s"}`}
                  className="relative h-24 w-24 shrink-0"
                >
                  <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90" aria-hidden>
                    <circle cx="48" cy="48" r={QUIZ_RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
                    <circle
                      cx="48" cy="48" r={QUIZ_RING_RADIUS} fill="none"
                      stroke="var(--teal)" strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={QUIZ_RING_CIRCUMFERENCE} strokeDashoffset={ringOffset}
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
                <Stack gap="1">
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    Average score
                  </p>
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    {articlesQuizzed} article{articlesQuizzed === 1 ? "" : "s"} quizzed
                  </p>
                  <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                    {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"}
                  </p>
                </Stack>
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
      </Section>
    </PageShell>
  );
}
