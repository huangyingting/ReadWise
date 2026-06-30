import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, rssUrlExtractor } from "./shared";

const knowable: Provider = {
  key: "knowable",
  name: "Knowable Magazine",
  hostnames: ["knowablemagazine.org", "www.knowablemagazine.org"],
  seeds: [
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=physical-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/physical-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=technology&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/technology",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=living-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/living-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=society&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/society",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=food-environment&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/food-environment",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?knowablemagazine\.org\/(?:content\/)?article\/[a-z-]+\/\d{4}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) => excludes(url, ["/search", "/about", "/contact", "/subscribe"]),
  defaultCategory: "science",
  categories: ["science", "environment", "health", "tech", "culture"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["science", "environment", "health", "tech", "culture"],
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/technology|computing|digital/, "tech"],
      [/health.?(&|and).?disease|\bhealth\b|disease|medical/, "health"],
      [/food.?(&|and).?environment|food-environment|environment|climate|sustainab|conservation|ecolog/, "environment"],
      [/living.?world|physical.?world|the.?mind|\bmind\b|\bscience\b/, "science"],
      [/\bsociety\b|culture/, "culture"],
      [/business|econom/, "business"],
    ]),
  /**
   * Discovers article URLs from Knowable's RSS feed (the seed search pages are
   * blocked with 403). Candidates are validated against `articleUrlPattern`
   * and `articleUrlFilter` by discovery.
   */
  urlExtractor: rssUrlExtractor(["https://knowablemagazine.org/rss"]),
  /**
   * Knowable's PB-hosted article pages embed donation CTAs, leftover Froala
   * editor menus and related-content rails inside (or around) the article
   * body. Strip them before extraction so the harvest keeps the real prose and
   * the article portrait while dropping the noise the user complained about:
   *
   *   - `promo-article` — in-body "Donate today" / "Support Knowable" CTAs
   *     (`promo-article-donate`, `promo-article-dark`).
   *   - `layout-mode-menu` — an un-hydrated Froala "layout menu" rendered on the
   *     live article pages as `article-layout-mode-menu` (comic pages use
   *     `comic-layout-mode-menu`). Its `<h4>LAYOUT MENU</h4>` heading leaked into
   *     the body as harvested prose, and its `<select><option>` template text
   *     ("Some Placeholder Text", "CREDIT: NAME", "Institution Name") plus lazy
   *     `placeholder_img.jpg` stand-ins otherwise rode along. Matching is a class
   *     SUBSTRING, so this single keyword drops both the `article-` and `comic-`
   *     variants.
   *   - `ymal` / `more-from` — "You may also like" and "More From" related-
   *     article rails (other articles' thumbnails, not this article's imagery).
   *   - `deep-dive` — the trailing "TAKE A DEEPER DIVE | Explore Related
   *     Scholarly Articles …" citation rail (`<section class="deep-dive">` with a
   *     `<div class="deep-dive-header">`). It lists OTHER journal articles' titles
   *     and abstracts and sits AFTER the real body (outside the `.fr-view`
   *     container), so dropping it removes the boilerplate the user complained
   *     about without touching prose. Matching is a class SUBSTRING, so the one
   *     `deep-dive` keyword also covers the nested `deep-dive-header`.
   *   - `article-doi` — the article's own visible DOI citation string
   *     (`<div class="article-doi">10.1146/knowable-…</div>`) rendered next to the
   *     deep-dive rail. The same DOI also appears in a `<head>` `<meta
   *     name="dc.identifier">`, but that lives outside the harvested body and is
   *     not extracted.
   *   - `<figcaption>` — image credit captions such as `CREDIT: …`; the sibling
   *     `<img>` stays in place so article imagery is preserved.
   *   - `site-header` / `site-footer` / `mobile-nav` — page chrome carrying the
   *     header/footer "DONATE" links.
   *
   * Note: matching is a class/id SUBSTRING test on block containers, so
   * `article-sidebar` is intentionally NOT listed — it would also match
   * `article-sidebar-img`, which holds the real article portrait we keep.
   * `deep-dive` and `article-doi` are likewise narrow enough not to collide with
   * any legitimate body class (verified by re-extraction: the real prose and the
   * `/docserver/` imagery survive).
   */
  cleanup: {
    dropClassKeywords: [
      "promo-article",
      "layout-mode-menu",
      "ymal",
      "more-from",
      "deep-dive",
      "article-doi",
      "site-header",
      "site-footer",
      "mobile-nav",
    ],
    dropFigcaptions: true,
  },
};

export default knowable;
