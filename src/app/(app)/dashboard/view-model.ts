/**
 * Dashboard view model — typed data shape for the dashboard page (REF-059).
 *
 * Centralises all data loading and derivation so the page component becomes a
 * thin composition root, and section components can be rendered with fixture
 * data without database access.
 */
import type { Role } from "@prisma/client";
import type { Profile } from "@prisma/client";
import type { StreakSummary, InProgressEntry, ProgressSummary } from "@/lib/engagement";
import type { QuizMastery } from "@/lib/learning/quiz-mastery";
import type { FeedPage } from "@/lib/feed";
import type { DifficultyLevel } from "@/lib/difficulty";
import { listInProgressArticles, getProgressSummaries, getStreakSummary } from "@/lib/engagement";
import { getQuizMastery } from "@/lib/learning/quiz-mastery";
import { getReviewSummary } from "@/lib/learning/flashcards";
import { getBookmarkedArticleIds } from "@/lib/article-library";
import { getProfile } from "@/features/profile-preferences/repository";
import { parseTopics } from "@/features/profile-preferences/schema";
import { getPersonalizedFeed } from "@/lib/feed";

export interface DashboardUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: Role;
}

export interface DashboardProfileShape {
  englishLevel: Profile["englishLevel"];
  ageRange: Profile["ageRange"] | null;
  gender: Profile["gender"] | null;
  topics: string[];
  dailyGoal: Profile["dailyGoal"];
}

export interface DashboardViewModel {
  user: DashboardUser;
  profile: DashboardProfileShape | null;
  isNewUser: boolean;
  hasTopics: boolean;
  dueCount: number;
  streak: StreakSummary;
  mastery: QuizMastery;
  inProgressEntries: InProgressEntry[];
  railIds: string[];
  feedPage: FeedPage;
  filteredArticles: FeedPage["articles"];
  filteredHasMore: boolean;
  feedProgress: Record<string, ProgressSummary>;
  bookmarkedIds: Set<string>;
  feedIds: string[];
  maxLevel: DifficultyLevel | null;
}

export async function loadDashboardViewModel(
  user: DashboardUser,
  maxLevel: DifficultyLevel | null,
): Promise<DashboardViewModel> {
  const [inProgressEntries, streak, mastery, profile, feedPage, reviewSummary] =
    await Promise.all([
      listInProgressArticles(user.id),
      getStreakSummary(user.id),
      getQuizMastery(user.id),
      getProfile(user.id),
      getPersonalizedFeed(user.id, { offset: 0, limit: 10, maxLevel }),
      getReviewSummary(user.id),
    ]);

  const dueCount = reviewSummary.dueCount;
  const filteredArticles = feedPage.articles;
  const filteredHasMore = feedPage.hasMore;

  const railIds = inProgressEntries.map((e) => e.article.id);
  const feedIds = filteredArticles.map((a) => a.id);
  const allIds = [...new Set([...railIds, ...feedIds])];

  const [feedProgress, bookmarkedIds] = await Promise.all([
    getProgressSummaries(user.id, feedIds),
    getBookmarkedArticleIds(user.id, allIds),
  ]);

  const userTopics = parseTopics(profile?.topics);
  const hasTopics = userTopics.length > 0;

  const isNewUser =
    inProgressEntries.length === 0 &&
    streak.currentStreak === 0 &&
    profile?.completedAt != null &&
    Date.now() - new Date(profile.completedAt).getTime() < 60 * 60 * 1000;

  const profileShape: DashboardProfileShape | null = profile
    ? {
        englishLevel: profile.englishLevel,
        ageRange: profile.ageRange ?? null,
        gender: profile.gender ?? null,
        topics: userTopics,
        dailyGoal: profile.dailyGoal,
      }
    : null;

  return {
    user,
    profile: profileShape,
    isNewUser,
    hasTopics,
    dueCount,
    streak,
    mastery,
    inProgressEntries,
    railIds,
    feedPage,
    filteredArticles,
    filteredHasMore,
    feedProgress,
    bookmarkedIds,
    feedIds,
    maxLevel,
  };
}
