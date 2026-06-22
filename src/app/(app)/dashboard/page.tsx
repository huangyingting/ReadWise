import Link from "next/link";
import { Sparkles, Compass, GraduationCap, SlidersHorizontal } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { getProgressSummaries, listInProgressArticles } from "@/lib/progress";
import { getStreakSummary } from "@/lib/activity";
import { getQuizMastery } from "@/lib/quiz-mastery";
import { getReviewSummary } from "@/lib/flashcards";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import { getProfile, parseTopics } from "@/lib/profile";
import { getPersonalizedFeed } from "@/lib/feed";
import { isDifficultyLevel } from "@/lib/difficulty";
import { Card } from "@/components/ui/Card";
import { Badge, buttonVariants } from "@/components/ui";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/EmptyState";
import StreakWidget from "@/components/StreakWidget";
import DailyGoal from "@/components/DailyGoal";
import MasteryWidget from "@/components/MasteryWidget";
import ForYouFeed from "@/components/ForYouFeed";
import DashboardLevelFilter from "@/components/DashboardLevelFilter";
import RailScroller from "@/components/RailScroller";
import LevelRecommendationBanner from "@/components/LevelRecommendationBanner";
import DashboardWelcomeBanner from "@/components/DashboardWelcomeBanner";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";


export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await requireOnboardedSession("/dashboard");
  const user = session.user;
  const { level: levelParam } = await searchParams;
  const maxLevel = isDifficultyLevel(levelParam) ? levelParam : null;

  const [inProgressEntries, streak, mastery, profile, feedPage, reviewSummary] = await Promise.all([
    listInProgressArticles(user.id),
    getStreakSummary(user.id),
    getQuizMastery(user.id),
    getProfile(user.id),
    getPersonalizedFeed(user.id, { offset: 0, limit: 10, maxLevel }),
    getReviewSummary(user.id),
  ]);

  const dueCount = reviewSummary.dueCount;

  // Apply optional CEFR level filter to the initial feed (#68, #211). The level
  // is now threaded through /api/feed so subsequent "Load more" pages stay
  // level-filtered and `hasMore` is accurate — no need to disable Load more.
  const filteredArticles = feedPage.articles;
  const filteredHasMore = feedPage.hasMore;

  // Union of rail + feed article ids for SSR progress + bookmark sync
  const railIds = inProgressEntries.map((e) => e.article.id);
  const feedIds = filteredArticles.map((a) => a.id);
  const allIds = [...new Set([...railIds, ...feedIds])];

  const [feedProgress, bookmarkedIds] = await Promise.all([
    getProgressSummaries(user.id, feedIds),
    getBookmarkedArticleIds(user.id, allIds),
  ]);

  // Cold-start detection: has the user chosen topics?
  const userTopics = parseTopics(profile?.topics);
  const hasTopics = userTopics.length > 0;

  // First-run detection: no reading progress + onboarding completed recently (within last hour).
  // We use streak.currentStreak and inProgressEntries as lightweight proxies.
  const isNewUser =
    inProgressEntries.length === 0 &&
    streak.currentStreak === 0 &&
    profile?.completedAt != null &&
    Date.now() - new Date(profile.completedAt).getTime() < 60 * 60 * 1000;

  return (
    <PageShell variant="listing">
      <PageHeader title="Dashboard" />
      {/* Identity card */}
      <Card>
        <div className="flex items-center gap-[var(--space-4)]">
          <Avatar src={user.image} name={user.name} size={56} />
          <div>
            <div className="font-semibold text-text">{user.name ?? "Unnamed reader"}</div>
            <div className="text-text-muted text-[length:var(--text-sm)]">{user.email}</div>
            <Badge variant={user.role === "Admin" ? "primary" : "neutral"} className="mt-[var(--space-1)]">
              {user.role}
            </Badge>
          </div>
        </div>
      </Card>

      {/* First-run welcome banner — shown once to new users (localStorage-gated client-side) */}
      {isNewUser && <DashboardWelcomeBanner />}

      {/* Level progression recommendation — shown when confidence ≥ 0.6 */}
      {profile && (
        <div className="mt-[var(--space-5)]">
          <LevelRecommendationBanner
            profile={{
              englishLevel: profile.englishLevel,
              ageRange: profile.ageRange ?? null,
              gender: profile.gender ?? null,
              topics: parseTopics(profile.topics),
              dailyGoal: profile.dailyGoal,
            }}
          />
        </div>
      )}

      {/* Your progress stats band: Streak | Goal | Mastery */}
      <section
        aria-labelledby="progress-h"
        className="mt-[var(--space-7)]"
      >
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

      {/* Continue-reading rail — only when in-progress articles exist */}
      {inProgressEntries.length > 0 ? (
        <section className="mt-[var(--space-7)]" aria-label="Continue reading">
          <div
            className="flex items-center justify-between mb-[var(--space-4)]"
          >
            <h2
              className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
            >
              Continue reading
            </h2>
            <span className="text-text-muted text-[length:var(--text-sm)]">
              {inProgressEntries.length} in progress
            </span>
          </div>
          <RailScroller>
            {inProgressEntries.map((entry) => (
              <ArticleCardView
                key={entry.article.id}
                article={entry.article}
                progress={entry.progress}
                variant="rail"
                saved={bookmarkedIds.has(entry.article.id)}
              />
            ))}
          </RailScroller>
          {/* Rail sync — rail ids are disjoint from feed ids (in-progress vs unread) */}
          <ListingProgressSync articleIds={railIds} />
          <ListingBookmarkSync articleIds={railIds} />
        </section>
      ) : null}

      {/* For You feed */}
      <section
        aria-labelledby="foryou-h"
        className="mt-[var(--space-7)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] mb-[var(--space-2)]">
          <h2
            id="foryou-h"
            className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          >
            For You
          </h2>

          {/* CEFR level filter — US-017 (#68). Client component handles auto-submit. */}
          <DashboardLevelFilter defaultValue={maxLevel ?? null} />
        </div>

        {/* Personalisation cue — calm, informational */}
        <p className="text-text-muted text-[length:var(--text-sm)] mt-0 mb-[var(--space-5)]">
          <SlidersHorizontal size={14} aria-hidden className="inline -mt-px mr-[var(--space-1)] text-text-subtle" />
          Based on your level and topics
        </p>

        {/* Cold-start (a): no topics chosen → send to settings */}
        {!hasTopics ? (
          <EmptyState
            icon={Sparkles}
            title="Pick a few topics to personalize your feed"
            description="Tell us what you like and we'll line up articles at your level."
            action={{ label: "Choose topics", href: "/settings" }}
          />
        ) : (
          /* Topics chosen — hand off to client component (handles empty + load more + sync) */
          <ForYouFeed
            key={maxLevel ?? "all"}
            level={maxLevel}
            initialArticles={filteredArticles}
            initialProgress={feedProgress}
            initialHasMore={filteredHasMore}
            initialOffset={filteredArticles.length}
            initialSavedIds={[...bookmarkedIds].filter((id) => feedIds.includes(id))}
            initialReasons={feedPage.reasons}
          />
        )}
      </section>

      {/* Browse by topic band — bridge to /browse */}
      <section className="mt-[var(--space-7)]">
        <Card>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-[var(--space-4)]">
            <div>
              <p className="font-semibold text-text m-0">Looking for something specific?</p>
              <p className="text-text-muted text-[length:var(--text-sm)] m-0">
                Explore every category and your topic Picks.
              </p>
            </div>
            <Link
              href="/browse"
              className={buttonVariants({ variant: "secondary", size: "md" })}
            >
              Browse by topic <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Card>
      </section>
    </PageShell>
  );
}

