import { TrendingUp, BookOpen, Zap, Star, Brain, BookMarked } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { getLearnerAnalytics } from "@/lib/learner-analytics";
import { getActivityHeatmap } from "@/lib/activity";
import { getLevelHistory, getCurrentLevel } from "@/lib/progress-helpers";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/EmptyState";
import Sparkline from "@/components/Sparkline";
import ActivityHeatmap from "@/components/ActivityHeatmap";
import LevelTimeline from "@/components/LevelTimeline";

export const metadata = { title: "My Progress — ReadWise" };

// ---------------------------------------------------------------------------
// Mini bar-chart (pure CSS/div — no chart lib needed)
// ---------------------------------------------------------------------------
function MiniBar({
  value,
  max,
  label,
  color = "var(--teal)",
}: {
  value: number;
  max: number;
  label: string;
  color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-[var(--space-2)]" title={label}>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 8, backgroundColor: "var(--border)" }}
        role="presentation"
      >
        <div
          style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 9999 }}
        />
      </div>
      <span
        className="text-[length:var(--text-xs)] text-text-subtle tabular-nums"
        style={{ minWidth: "2ch", textAlign: "right" }}
        aria-label={`${value} ${label}`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly bar chart (12 bars)
// ---------------------------------------------------------------------------
function WeeklyBars({
  buckets,
  label,
  color = "var(--teal)",
}: {
  buckets: { week: string; count: number }[];
  label: string;
  color?: string;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <figure aria-label={label}>
      <figcaption className="sr-only">{label}</figcaption>
      <div
        className="flex items-end gap-[var(--space-1)]"
        style={{ height: 64 }}
        aria-hidden
      >
        {buckets.map((b) => {
          const h = Math.max(Math.round((b.count / max) * 56), b.count > 0 ? 4 : 2);
          return (
            <div
              key={b.week}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: h,
                backgroundColor: b.count > 0 ? color : "var(--border)",
                opacity: b.count > 0 ? 1 : 0.4,
              }}
              title={`${b.week}: ${b.count}`}
            />
          );
        })}
      </div>
      {/* Week axis labels — first and last only */}
      <div className="flex justify-between mt-1">
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {buckets[0]?.week.replace(/^\d{4}-/, "")}
        </span>
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {buckets[buckets.length - 1]?.week.replace(/^\d{4}-/, "")}
        </span>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "var(--teal)",
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <div className="flex items-start gap-[var(--space-3)]">
        <span
          className="shrink-0 rounded-[var(--radius-md)] p-[var(--space-2)]"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
          aria-hidden
        >
          <Icon size={20} style={{ color }} />
        </span>
        <div>
          <p className="text-[length:var(--text-sm)] text-text-subtle">{label}</p>
          <p
            className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text leading-tight"
          >
            {value}
          </p>
          {sub && <p className="text-[length:var(--text-xs)] text-text-subtle mt-[var(--space-1)]">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function ProgressPage() {
  const session = await requireOnboardedSession("/progress");
  const [analytics, heatmapCells, levelHistory, currentLevel] = await Promise.all([
    getLearnerAnalytics(session.user.id),
    getActivityHeatmap(session.user.id),
    getLevelHistory(session.user.id),
    getCurrentLevel(session.user.id),
  ]);

  const {
    totalCompleted,
    totalInProgress,
    totalSavedWords,
    totalQuizAttempts,
    averageQuizScore,
    completionsByWeek,
    wordsByWeek,
    quizScoreTrend,
    completedByLevel,
    currentStreak,
    longestStreak,
  } = analytics;

  const hasAnyData = totalCompleted + totalInProgress + totalSavedWords + totalQuizAttempts > 0;

  const sparkLabel =
    quizScoreTrend.length > 0
      ? `Recent quiz scores oldest to newest: ${quizScoreTrend.join(", ")} percent.`
      : "No quiz attempts yet.";

  return (
    <div className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text mb-[var(--space-6)]"
      >
        My Progress
      </h1>

      {!hasAnyData && !currentLevel ? (
        <EmptyState
          icon={TrendingUp}
          title="Nothing to show yet"
          description="Read some articles, save words, or take quizzes to see your progress here."
          action={{ label: "Browse articles", href: "/browse" }}
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-7)]">

          {hasAnyData && (
            <>
          {/* ── Stat overview ── */}
          <section aria-labelledby="overview-h">
            <h2
              id="overview-h"
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
            >
              Overview
            </h2>
            <div className="grid grid-cols-2 gap-[var(--space-4)] sm:grid-cols-3 lg:grid-cols-4">
              <StatCard
                icon={BookOpen}
                label="Articles completed"
                value={totalCompleted}
                color="var(--teal)"
              />
              <StatCard
                icon={BookMarked}
                label="In progress"
                value={totalInProgress}
                color="var(--primary)"
              />
              <StatCard
                icon={Brain}
                label="Words saved"
                value={totalSavedWords}
                color="var(--stat-vocab)"
              />
              <StatCard
                icon={Zap}
                label="Current streak"
                value={`${currentStreak}d`}
                sub={`Best: ${longestStreak} day${longestStreak !== 1 ? "s" : ""}`}
                color="var(--stat-streak)"
              />
              {averageQuizScore !== null && (
                <StatCard
                  icon={Star}
                  label="Avg quiz score"
                  value={`${averageQuizScore}%`}
                  sub={`${totalQuizAttempts} attempt${totalQuizAttempts !== 1 ? "s" : ""}`}
                  color="var(--stat-quiz)"
                />
              )}
            </div>
          </section>

          {/* ── Reading activity chart ── */}
          <section aria-labelledby="reading-h">
            <h2
              id="reading-h"
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
            >
              Reading activity
              <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
                last 12 weeks
              </span>
            </h2>
            <Card>
              <WeeklyBars
                buckets={completionsByWeek}
                label="Articles completed per week over the last 12 weeks"
                color="var(--teal)"
              />
              <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
                Completed articles per week
              </p>
            </Card>
          </section>

          {/* ── Vocabulary growth ── */}
          {totalSavedWords > 0 && (
            <section aria-labelledby="vocab-h">
              <h2
                id="vocab-h"
                className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
              >
                Vocabulary growth
                <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
                  last 12 weeks
                </span>
              </h2>
              <Card>
                <WeeklyBars
                  buckets={wordsByWeek}
                  label="Words saved per week over the last 12 weeks"
                  color="var(--stat-vocab)"
                />
                <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
                  Words saved per week
                </p>
              </Card>
            </section>
          )}

          {/* ── Quiz score trend ── */}
          {quizScoreTrend.length > 0 && (
            <section aria-labelledby="quiz-h">
              <h2
                id="quiz-h"
                className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
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
          )}

          {/* ── Level distribution ── */}
          {completedByLevel.length > 0 && (
            <section aria-labelledby="level-h">
              <h2
                id="level-h"
                className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
              >
                Level distribution
                <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
                  completed articles
                </span>
              </h2>
              <Card>
                <div className="flex flex-col gap-[var(--space-3)]">
                  {completedByLevel.map((b) => {
                    const maxCount = Math.max(...completedByLevel.map((x) => x.count), 1);
                    return (
                      <div key={b.level} className="flex items-center gap-[var(--space-3)]">
                        <span
                          className="shrink-0 text-[length:var(--text-sm)] font-semibold text-text-subtle tabular-nums"
                          style={{ minWidth: "3ch" }}
                        >
                          {b.level}
                        </span>
                        <div className="flex-1">
                          <MiniBar
                            value={b.count}
                            max={maxCount}
                            label={`${b.level} articles`}
                            color="var(--teal)"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </section>
          )}

          </>
          )}

          {/* ── Activity heatmap (#96) ── */}
          <section aria-labelledby="heatmap-h">
            <h2
              id="heatmap-h"
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
            >
              Reading streak
              <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
                last 52 weeks
              </span>
            </h2>
            <Card>
              <ActivityHeatmap cells={heatmapCells} />
            </Card>
          </section>

          {/* ── CEFR level timeline (#97) ── */}
          {currentLevel && (
            <section aria-labelledby="timeline-h">
              <h2
                id="timeline-h"
                className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text mb-[var(--space-4)]"
              >
                Level progression
              </h2>
              <Card>
                <LevelTimeline history={levelHistory} currentLevel={currentLevel} />
              </Card>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
