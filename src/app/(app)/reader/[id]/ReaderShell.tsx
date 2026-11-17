/**
 * Reader shell composition (REF-029).
 *
 * Wires together the client provider tree, reading-column layout, and
 * presentational sub-components for the reader page. Receives pre-loaded
 * `ReaderPageData` so all data fetching stays in the page loader and this
 * component remains a pure server-side composition layer.
 *
 * Provider order is intentional and must be preserved:
 *   0. ReaderLevelProvider     — reading level shown (#1303)
 *   1. ReaderAudioProvider     — shared audio element and narration state
 *   2. ReaderHighlightsProvider — highlight CRUD and optimistic state
 *      ReaderClassAnnotationsProvider — classroom guided prompts (#1307)
 *   3. ReaderToolsProvider     — tools surface / word-lookup context
 *   4. ReaderLayout            — responsive grid (reading column + tools rail)
 *   5. ReaderMiniPlayer        — fixed bottom audio mini-player (outside layout)
 *
 * The shell renders inside `#reader-root` with `suppressHydrationWarning` so
 * the root-layout reader preference bootstrap can mutate `data-*` attributes
 * before hydration without triggering a React mismatch warning.
 *
 * Client providers are scoped inside `#reader-root` to avoid wrapping the
 * entire RSC page output. Hoisting them to the top of the RSC tree would
 * create a second Suspense boundary that races with the route-segment
 * Suspense (loading.tsx), leaving the streaming container visible and
 * duplicating the DOM (#48).
 */
import type { ReactNode } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/translation";
import type { ReaderPageData } from "@/lib/reader/page-loader";
import ArticleHero from "@/components/ArticleHero";
import BilingualBody from "@/components/reader/BilingualBody";
import WordLookupHint from "@/components/reader/wordLookup/WordLookupHint";
import ReaderControls from "@/components/ReaderControls";
import ReaderLayout from "@/components/ReaderLayout";
import ReaderToolsSurface from "@/components/ReaderToolsSurface";
import { ReaderToolsProvider } from "@/components/ReaderToolsProvider";
import { ReaderAudioProvider } from "@/components/ReaderAudioProvider";
import { ReaderHighlightsProvider } from "@/components/ReaderHighlightsProvider";
import { ReaderClassAnnotationsProvider } from "@/components/reader/ReaderClassAnnotationsProvider";
import ReaderMiniPlayer from "@/components/ReaderMiniPlayer";
import ArticleStudySection from "@/components/ArticleStudySection";
import ArticleDifficultyFeedback from "@/components/ArticleDifficultyFeedback";
import ReaderReadingBlockTracker from "@/components/reader/ReaderReadingBlockTracker";
import ReaderTimeTracker from "@/components/reader/ReaderTimeTracker";
import ClassPromptsNotice from "@/components/reader/ClassPromptsNotice";
import WordLookup from "@/components/reader/wordLookup/WordLookup";
import { ReaderLevelProvider } from "@/components/reader/ReaderLevelContext";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "@/lib/article-levels/levels";
import ReaderLevelSwitcher from "./ReaderLevelSwitcher";
import { EducatorBar, StudentPreviewBanner } from "@/components/reader/EducatorTools";
import { ReaderActivitiesProvider, ReaderCheckpoints, ReaderPollCards } from "@/components/reader/ReaderActivities";
import { readerLevelHref } from "@/lib/article-levels/levels";
import ArticleHeader from "./ArticleHeader";
import AssignmentBanner from "./AssignmentBanner";
import KeepReadingSection from "./KeepReadingSection";

type Props = {
  data: ReaderPageData;
  /** Today Session v1.1 (#805): render the "Set as today's article" affordance. */
  setTodayEnabled?: boolean;
};

type ReaderProvidersProps = {
  articleId: string;
  levelKey: ReadingLevelKey;
  /** Educator "View as student" preview (#1304). */
  previewing: boolean;
  children: ReactNode;
};

type ReaderArticleColumnProps = {
  data: ReaderPageData;
  setTodayEnabled: boolean;
};

function ReaderProviders({ articleId, levelKey, previewing, children }: ReaderProvidersProps) {
  return (
    <ReaderLevelProvider level={levelKey}>
      <ReaderAudioProvider>
        <ReaderHighlightsProvider articleId={articleId} levelKey={levelKey}>
          <ReaderClassAnnotationsProvider articleId={articleId} levelKey={levelKey}>
            <ReaderActivitiesProvider articleId={articleId} preview={previewing}>
              <ReaderToolsProvider>{children}</ReaderToolsProvider>
            </ReaderActivitiesProvider>
          </ReaderClassAnnotationsProvider>

          {/* Fixed bottom audio mini-player (appears after first narration load) */}
          <ReaderMiniPlayer />
        </ReaderHighlightsProvider>
      </ReaderAudioProvider>
    </ReaderLevelProvider>
  );
}

function ReaderArticleColumn({ data, setTodayEnabled }: ReaderArticleColumnProps) {
  const {
    article,
    progress,
    difficultyLevel,
    isValidCefrLevel,
    tags,
    keepReadingArticles,
    relatedProgress,
    isBookmarked,
    isCompleted,
    userDifficultyVote,
    readingMinutes,
    cleanBody,
    hadRelated,
    studentAssignments,
    level,
    displayTitle,
    educator,
    articlePlainText,
  } = data;
  const isOriginal = level.key === ORIGINAL_LEVEL;
  const readerHref = readerLevelHref(article.id, level.key);
  const previewHref = `${readerHref}${readerHref.includes("?") ? "&" : "?"}view=student`;

  return (
    <div className="reader-column">
      {/* Reader-local skip link: lets keyboard users jump past the sticky
          controls directly to the article (WCAG 2.4.1, #65).
          Sits before ReaderControls so Tab from global skip target reaches
          it first. */}
      <a href="#reader-article" className="skip-link">
        Skip to article
      </a>

      {/* Slim sticky toolbar: Back · Listen · Aa (display settings) · Tools */}
      <ReaderControls articleId={article.id} narrationAvailable={isOriginal} />

      {/* Educator tools / student preview (#1304) */}
      {educator.previewing ? <StudentPreviewBanner exitHref={readerHref} /> : null}
      {educator.isEducator && !educator.previewing ? (
        <EducatorBar
          articleId={article.id}
          articleTitle={displayTitle}
          plainText={articlePlainText}
          classrooms={educator.classrooms}
          previewHref={previewHref}
        />
      ) : null}

      <article id="reader-article" tabIndex={-1} aria-labelledby="article-title">
        <ArticleHeader
          article={article}
          difficultyLevel={difficultyLevel}
          isValidCefrLevel={isValidCefrLevel}
          readingMinutes={readingMinutes}
          progress={progress}
          isBookmarked={isBookmarked}
          tags={tags}
          setTodayEnabled={setTodayEnabled}
          displayTitle={displayTitle}
        />

        {/* Reading level pills (#1303) — only for articles with adapted levels */}
        <ReaderLevelSwitcher articleId={article.id} level={level} />

        {/* Assignment banner — shown only when the student has assignments for this article */}
        <AssignmentBanner assignments={studentAssignments} />

        {/* Classroom guided prompts (#1307) — learners and teaching staff only */}
        <ClassPromptsNotice />

        {/* Pre-reading poll from the learner's assignment (#1304) */}
        <ReaderPollCards />

        {/* Hero image — graceful 16:9 frame that collapses on error */}
        <ArticleHero src={article.heroImage} alt={article.title} />

        {/* Word-lookup / highlight hint — dismissible (localStorage) */}
        <WordLookupHint />

        {/* Prose — bilingual-capable wrapper (falls back to normal WordLookup when disabled) */}
        {/* Translations cover the original text only, so adapted levels
            (#1303) render the prose without the bilingual strip. */}
        {isOriginal ? (
          <BilingualBody
            html={cleanBody}
            articleId={article.id}
            languages={SUPPORTED_LANGUAGES}
          />
        ) : (
          <WordLookup html={cleanBody} articleId={article.id} languages={SUPPORTED_LANGUAGES} />
        )}
      </article>

      {/* Checks for Understanding from the learner's assignment (#1304) */}
      <ReaderCheckpoints />

      {/* #376 — Observe the prose to track current reading block.
          #378 — Track active reading time for WPM analytics.
          Both render null and must be inside ReaderToolsProvider. */}
      <ReaderReadingBlockTracker />
      <ReaderTimeTracker articleId={article.id} />

      {/* Difficulty feedback widget (#124) */}
      <ArticleDifficultyFeedback
        articleId={article.id}
        initialVote={userDifficultyVote}
        difficulty={difficultyLevel}
      />

      {/* Read-after practice & study tools — in-flow SSR anchor/CTA
          that opens the responsive Tools surface (#153). */}
      <ArticleStudySection />

      {/* Keep reading — CTA section after the article body (#110) */}
      <KeepReadingSection
        articles={keepReadingArticles}
        relatedProgress={relatedProgress}
        isCompleted={isCompleted}
        hadRelated={hadRelated}
      />
    </div>
  );
}

export default function ReaderShell({ data, setTodayEnabled = false }: Props) {
  const { article, articlePlainText } = data;

  return (
    <div id="reader-root" suppressHydrationWarning>
      {/* Provider tree scoped inside #reader-root — see module docblock. */}
      {/* Keyed by level so level-scoped client state (highlights, prompts,
          quiz) resets when the reader switches levels (#1303). */}
      <ReaderProviders
        key={`${data.level.key}:${data.educator.previewing}`}
        articleId={article.id}
        levelKey={data.level.key}
        previewing={data.educator.previewing}
      >
        <ReaderLayout>
          {/* ---- Reading column ---- */}
          <ReaderArticleColumn data={data} setTodayEnabled={setTodayEnabled} />

          {/* ---- Tools surface ---- second grid column on xl (sticky rail),
               a focus-trapped bottom sheet on <xl. Single mounted instance. */}
          <ReaderToolsSurface articleId={article.id} plainText={articlePlainText} />
        </ReaderLayout>
      </ReaderProviders>
    </div>
  );
}
