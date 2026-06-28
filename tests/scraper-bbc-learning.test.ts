/**
 * Tests for the BBC Learning English over-capture fix.
 *
 * "6 Minute English" episode pages append a "More 6 Minute English" block of
 * ~40 one-line blurbs for OTHER episodes (in `widget-list-automatic`
 * containers) plus course/footer navigation AFTER the real lesson transcript
 * (a separate `widget-richtext` container). Left in place these inflate a
 * ~1,200-word transcript to ~6,000 words ("31 min read"). The provider's
 * `cleanup` config drops the noise blocks before extraction.
 *
 * All fixtures are inline — no network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProviderCleanup } from "@/lib/scraper/cleanup";
import { extractArticle } from "@/lib/scraper/extract";
import { getProvider } from "@/lib/scraper/providers";

const EPISODE_URL =
  "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english/ep-210520";

/**
 * Minimal episode-page fixture mirroring the real DOM shape: a single
 * `widget-richtext` transcript plus the noise containers we want gone —
 * a `widget-list-automatic` related-episodes list and BBC LE navigation.
 */
const EPISODE_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="6 Minute English: The benefits of solitude" />
  </head>
  <body>
    <div class="bbcle-expandable-nav bbcle-course-nav-list" id="navIndex-0">
      <a class="bbcle-expandable-nav-button bbcle-nav-button">Unit 1</a>
      <p>Course navigation listing every other unit in the course.</p>
    </div>
    <div class="widget widget-richtext 6">
      <h2>Introduction</h2>
      <p>Are you happy being all alone, in silence, for long periods of time? Some people
        love it and others hate the idea of solitude. In this programme we explore why some
        people enjoy their own company.</p>
      <p>Neil and Rob discuss the topic and teach related vocabulary so you can practise your
        English while learning about the benefits of being alone.</p>
      <p>The discussion includes useful phrases and everyday examples that help you understand
        how native speakers talk about solitude and personal space in natural conversation.</p>
    </div>
    <div class="widget widget-list widget-list-automatic" data-widget-index="7">
      <h3>More 6 Minute English</h3>
      <ul class="widget-list">
        <li class="item"><a href="/a">Can a woollen hat make a difference when you are cold?</a></li>
        <li class="item"><a href="/b">Neil and Catherine talk about genealogy</a></li>
        <li class="item"><a href="/c">The extremophile microbes that survive extreme conditions</a></li>
      </ul>
    </div>
    <div class="bbcle-footer-nav-list">
      <a href="/more">Footer navigation to many other lessons</a>
    </div>
  </body>
</html>`;

test("bbc-learning-english provider defines cleanup rules", () => {
  const provider = getProvider("bbc-learning-english");
  assert.ok(provider?.cleanup?.dropClassKeywords?.length, "cleanup.dropClassKeywords must be set");
  assert.ok(
    provider!.cleanup!.dropClassKeywords!.includes("widget-list-automatic"),
    "must drop the related-episode automatic lists",
  );
});

test("cleanup drops related-episode lists and nav, retains the transcript", () => {
  const provider = getProvider("bbc-learning-english");
  const cleaned = applyProviderCleanup(EPISODE_HTML, provider!.cleanup!);

  // Transcript (widget-richtext) survives.
  assert.match(cleaned, /happy being all alone/, "transcript text must be retained");
  assert.match(cleaned, /benefits of being alone/, "transcript body must be retained");

  // Related-episode blurbs (widget-list-automatic) are gone.
  assert.doesNotMatch(cleaned, /woollen hat/i, "related-episode blurb must be removed");
  assert.doesNotMatch(cleaned, /genealogy/i, "related-episode blurb must be removed");
  assert.doesNotMatch(cleaned, /extremophile/i, "related-episode blurb must be removed");

  // Course + footer navigation are gone.
  assert.doesNotMatch(cleaned, /Course navigation/i, "course nav must be removed");
  assert.doesNotMatch(cleaned, /Footer navigation/i, "footer nav must be removed");
});

test("extractArticle on a 6 Minute English page excludes related-episode bloat", () => {
  const result = extractArticle(EPISODE_HTML, EPISODE_URL);
  assert.ok(result, "extraction must succeed");

  // Provider resolved to BBC Learning English (so the cleanup ran).
  assert.equal(result!.source, "BBC Learning English");

  // Transcript retained; over-capture blurbs excluded from the final body.
  assert.match(result!.content, /happy being all alone/, "transcript must be retained");
  assert.doesNotMatch(result!.content, /woollen hat/i, "blurb must be excluded");
  assert.doesNotMatch(result!.content, /genealogy/i, "blurb must be excluded");
  assert.doesNotMatch(result!.content, /extremophile/i, "blurb must be excluded");

  // Word count reflects the lesson transcript only (not the ~40 related blurbs).
  assert.ok(result!.wordCount < 150, `word count should be transcript-sized, got ${result!.wordCount}`);
});
