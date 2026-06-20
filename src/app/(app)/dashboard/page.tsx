import Image from "next/image";
import Link from "next/link";
import { Sparkles, Compass } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { getProgressSummaries, listInProgressArticles } from "@/lib/progress";
import { getStreakSummary } from "@/lib/activity";
import { getQuizMastery } from "@/lib/quiz-mastery";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import { getProfile, parseTopics } from "@/lib/profile";
import { getPersonalizedFeed } from "@/lib/feed";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import EmptyState from "@/components/EmptyState";
import StreakWidget from "@/components/StreakWidget";
import DailyGoal from "@/components/DailyGoal";
import MasteryWidget from "@/components/MasteryWidget";
import ForYouFeed from "@/components/ForYouFeed";


export default async function DashboardPage() {
  const session = await requireOnboardedSession("/dashboard");
  const user = session.user;

  const [inProgressEntries, streak, mastery, profile, feedPage] = await Promise.all([
    listInProgressArticles(user.id),
    getStreakSummary(user.id),
    getQuizMastery(user.id),
    getProfile(user.id),
    getPersonalizedFeed(user.id, { offset: 0, limit: 10 }),
  ]);

  // Union of rail + feed article ids for SSR progress + bookmark sync
  const railIds = inProgressEntries.map((e) => e.article.id);
  const feedIds = feedPage.articles.map((a) => a.id);
  const allIds = [...new Set([...railIds, ...feedIds])];

  const [feedProgress, bookmarkedIds] = await Promise.all([
    getProgressSummaries(user.id, feedIds),
    getBookmarkedArticleIds(user.id, allIds),
  ]);

  // Cold-start detection: has the user chosen topics?
  const userTopics = parseTopics(profile?.topics);
  const hasTopics = userTopics.length > 0;

  return (
    <main className="listing-container">
      {/* Identity card */}
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "1.5rem" }}
      >
        Dashboard
      </h1>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? "avatar"}
              width={56}
              height={56}
              className="rounded-full"
              unoptimized
            />
          ) : null}
          <div>
            <div className="font-semibold text-text">{user.name ?? "Unnamed reader"}</div>
            <div className="text-text-muted text-[length:var(--text-sm)]">{user.email}</div>
            <div className="text-text-muted text-[length:var(--text-sm)]">{user.role}</div>
          </div>
        </div>
      </Card>

      {/* Your progress stats band: Streak | Goal | Mastery */}
      <section
        aria-labelledby="progress-h"
        style={{ marginTop: "var(--space-7)" }}
      >
        <h2
          id="progress-h"
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          style={{ marginBottom: "var(--space-4)" }}
        >
          Your progress
        </h2>
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
        <section style={{ marginTop: "var(--space-9)" }} aria-label="Continue reading">
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
          <div
            tabIndex={0}
            className="flex gap-[var(--space-4)] overflow-x-auto pb-[var(--space-3)] -mx-[var(--space-1)] px-[var(--space-1)] snap-x snap-mandatory rw-rail-mask"
            style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
          >
            {inProgressEntries.map((entry) => (
              <ArticleCardView
                key={entry.article.id}
                article={entry.article}
                progress={entry.progress}
                variant="rail"
                saved={bookmarkedIds.has(entry.article.id)}
              />
            ))}
          </div>
          {/* Rail sync — rail ids are disjoint from feed ids (in-progress vs unread) */}
          <ListingProgressSync articleIds={railIds} />
          <ListingBookmarkSync articleIds={railIds} />
        </section>
      ) : null}

      {/* For You feed */}
      <section
        aria-labelledby="foryou-h"
        style={{ marginTop: "var(--space-9)" }}
      >
        <div className="flex items-center justify-between mb-[var(--space-2)]">
          <h2
            id="foryou-h"
            className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
          >
            For You
          </h2>
        </div>

        {/* Personalisation cue — calm, informational */}
        <p className="text-text-muted text-[length:var(--text-sm)] mt-0 mb-[var(--space-5)]">
          <Sparkles size={14} aria-hidden className="inline -mt-px mr-[var(--space-1)] text-text-subtle" />
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
            initialArticles={feedPage.articles}
            initialProgress={feedProgress}
            initialHasMore={feedPage.hasMore}
            initialOffset={feedPage.articles.length}
            initialSavedIds={[...bookmarkedIds].filter((id) => feedIds.includes(id))}
            initialReasons={feedPage.reasons}
          />
        )}
      </section>

      {/* Browse by topic band — bridge to /browse */}
      <section style={{ marginTop: "var(--space-9)" }}>
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
              Browse by topic →
            </Link>
          </div>
        </Card>
      </section>
    </main>
  );
}

