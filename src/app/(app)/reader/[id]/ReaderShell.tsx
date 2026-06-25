/**
 * Reader shell composition (REF-029).
 *
 * Wires together the client provider tree, reading-column layout, and
 * presentational sub-components for the reader page. Receives pre-loaded
 * `ReaderPageData` so all data fetching stays in the page loader and this
 * component remains a pure server-side composition layer.
 *
 * Provider order is intentional and must be preserved:
 *   1. ReaderAudioProvider     — shared audio element and narration state
 *   2. ReaderHighlightsProvider — highlight CRUD and optimistic state
 *   3. ReaderToolsProvider     — tools surface / word-lookup context
 *   4. ReaderLayout            — responsive grid (reading column + tools rail)
 *   5. ReaderMiniPlayer        — fixed bottom audio mini-player (outside layout)
 *
 * The shell renders inside `#reader-root` with `suppressHydrationWarning` so
 * the no-flash preference script can mutate `data-*` attributes before
 * hydration without triggering a React mismatch warning.
 *
 * Client providers are scoped inside `#reader-root` to avoid wrapping the
 * entire RSC page output. Hoisting them to the top of the RSC tree would
 * create a second Suspense boundary that races with the route-segment
 * Suspense (loading.tsx), leaving the streaming container visible and
 * duplicating the DOM (#48).
 */
import { SUPPORTED_LANGUAGES } from "@/lib/translation";
import type { ReaderPageData } from "@/lib/reader/page-loader";
import ArticleHero from "@/components/ArticleHero";
import BilingualBody from "@/components/BilingualBody";
import WordLookupHint from "@/components/WordLookupHint";
import ReaderControls from "@/components/ReaderControls";
import ReaderLayout from "@/components/ReaderLayout";
import ReaderToolsSurface from "@/components/ReaderToolsSurface";
import { ReaderToolsProvider } from "@/components/ReaderToolsProvider";
import { ReaderAudioProvider } from "@/components/ReaderAudioProvider";
import { ReaderHighlightsProvider } from "@/components/ReaderHighlightsProvider";
import ReaderMiniPlayer from "@/components/ReaderMiniPlayer";
import ArticleStudySection from "@/components/ArticleStudySection";
import ArticleDifficultyFeedback from "@/components/ArticleDifficultyFeedback";
import ReaderReadingBlockTracker from "@/components/reader/ReaderReadingBlockTracker";
import ReaderTimeTracker from "@/components/reader/ReaderTimeTracker";
import ReaderPrefsScript from "./ReaderPrefsScript";
import ArticleHeader from "./ArticleHeader";
import KeepReadingSection from "./KeepReadingSection";

type Props = {
  data: ReaderPageData;
};

export default function ReaderShell({ data }: Props) {
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
    articlePlainText,
    hadRelated,
  } = data;

  return (
    <div id="reader-root" suppressHydrationWarning>
      {/*
       * No-flash inline script: MUST be the first child of #reader-root so
       * that document.currentScript.parentElement resolves to the element
       * BEFORE any of its children are painted. Using getElementById fails
       * because the script executes before #reader-root finishes parsing.
       * suppressHydrationWarning on the parent prevents React from warning
       * about the pre-hydration attribute mutation.
       */}
      <ReaderPrefsScript />

      {/* Provider tree scoped inside #reader-root — see module docblock. */}
      <ReaderAudioProvider>
        <ReaderHighlightsProvider articleId={article.id}>
          <ReaderToolsProvider>
            <ReaderLayout>
              {/* ---- Reading column ---- */}
              <div className="reader-column">
                {/* Reader-local skip link: lets keyboard users jump past the sticky
                    controls directly to the article (WCAG 2.4.1, #65).
                    Sits before ReaderControls so Tab from global skip target reaches
                    it first. */}
                <a href="#reader-article" className="skip-link">
                  Skip to article
                </a>

                {/* Slim sticky toolbar: Back · Listen · Aa (display settings) · Tools */}
                <ReaderControls articleId={article.id} />

                <article id="reader-article" tabIndex={-1} aria-labelledby="article-title">
                  <ArticleHeader
                    article={article}
                    difficultyLevel={difficultyLevel}
                    isValidCefrLevel={isValidCefrLevel}
                    readingMinutes={readingMinutes}
                    progress={progress}
                    isBookmarked={isBookmarked}
                    tags={tags}
                  />

                  {/* Hero image — graceful 16:9 frame that collapses on error */}
                  <ArticleHero src={article.heroImage} alt={article.title} />

                  {/* Word-lookup / highlight hint — dismissible (localStorage) */}
                  <WordLookupHint />

                  {/* Prose — bilingual-capable wrapper (falls back to normal WordLookup when disabled) */}
                  <BilingualBody
                    html={cleanBody}
                    articleId={article.id}
                    languages={SUPPORTED_LANGUAGES}
                  />
                </article>

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

              {/* ---- Tools surface ---- second grid column on xl (sticky rail),
                   a focus-trapped bottom sheet on <xl. Single mounted instance. */}
              <ReaderToolsSurface articleId={article.id} plainText={articlePlainText} />
            </ReaderLayout>
          </ReaderToolsProvider>

          {/* Fixed bottom audio mini-player (appears after first narration load) */}
          <ReaderMiniPlayer />
        </ReaderHighlightsProvider>
      </ReaderAudioProvider>
    </div>
  );
}
