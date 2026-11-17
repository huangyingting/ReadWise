/**
 * Unit tests for academic citation formatting (#1306): MLA 9, APA 7, Chicago.
 *
 * Covers the happy path for each style plus the edge cases the issue calls
 * out — missing author, missing publish date, multi-author bylines — and
 * corporate authors, name suffixes, URL/site fallbacks, and italics parts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CITATION_STYLES,
  articleCitationSource,
  formatAllCitations,
  formatCitation,
  parseAuthors,
  type CitationSource,
} from "@/lib/citations";

const ACCESSED = new Date("2026-11-17T12:00:00.000Z");
const opts = { accessedAt: ACCESSED };

const FULL: CitationSource = {
  title: "Why Octopuses Are So Smart",
  author: "By Jane Smith",
  source: "BBC Future",
  publishedAt: "2024-05-03T08:00:00.000Z",
  url: "https://www.bbc.com/future/article/octopus",
};

function cite(source: CitationSource, style: "mla" | "apa" | "chicago") {
  return formatCitation(source, style, opts).text;
}

test("MLA 9, APA 7, and Chicago for a complete article", () => {
  assert.equal(
    cite(FULL, "mla"),
    "Smith, Jane. “Why Octopuses Are So Smart.” BBC Future, 3 May 2024, www.bbc.com/future/article/octopus.",
  );
  assert.equal(
    cite(FULL, "apa"),
    "Smith, J. (2024, May 3). Why Octopuses Are So Smart. BBC Future. https://www.bbc.com/future/article/octopus",
  );
  assert.equal(
    cite(FULL, "chicago"),
    "Smith, Jane. “Why Octopuses Are So Smart.” BBC Future, May 3, 2024. https://www.bbc.com/future/article/octopus.",
  );
});

test("italic parts mark the site (MLA/Chicago) and the title (APA)", () => {
  const italics = (style: "mla" | "apa" | "chicago") =>
    formatCitation(FULL, style, opts)
      .parts.filter((part) => part.italic)
      .map((part) => part.text);
  assert.deepEqual(italics("mla"), ["BBC Future"]);
  assert.deepEqual(italics("chicago"), ["BBC Future"]);
  assert.deepEqual(italics("apa"), ["Why Octopuses Are So Smart"]);
});

test("missing author starts with the title in every style", () => {
  const source = { ...FULL, author: null };
  assert.equal(cite(source, "mla"), "“Why Octopuses Are So Smart.” BBC Future, 3 May 2024, www.bbc.com/future/article/octopus.");
  assert.equal(
    cite(source, "apa"),
    "Why Octopuses Are So Smart. (2024, May 3). BBC Future. https://www.bbc.com/future/article/octopus",
  );
  assert.equal(
    cite(source, "chicago"),
    "“Why Octopuses Are So Smart.” BBC Future, May 3, 2024. https://www.bbc.com/future/article/octopus.",
  );
});

test("missing publish date adds access/retrieval dates", () => {
  const source = { ...FULL, publishedAt: null, title: "Can Cities Cool Down?" };
  assert.equal(
    cite(source, "mla"),
    "Smith, Jane. “Can Cities Cool Down?” BBC Future, www.bbc.com/future/article/octopus. Accessed 17 Nov. 2026.",
  );
  assert.equal(
    cite(source, "apa"),
    "Smith, J. (n.d.). Can Cities Cool Down? BBC Future. Retrieved November 17, 2026, from https://www.bbc.com/future/article/octopus",
  );
  assert.equal(
    cite(source, "chicago"),
    "Smith, Jane. “Can Cities Cool Down?” BBC Future. Accessed November 17, 2026. https://www.bbc.com/future/article/octopus.",
  );
});

test("two authors", () => {
  const source = { ...FULL, author: "Jane Smith and John Doe" };
  assert.match(cite(source, "mla"), /^Smith, Jane, and John Doe\. /);
  assert.match(cite(source, "apa"), /^Smith, J\., & Doe, J\. \(2024/);
  assert.match(cite(source, "chicago"), /^Smith, Jane, and John Doe\. /);
});

test("three or more authors", () => {
  const source = { ...FULL, author: "Ann Lee, Bo Chan, and Cy Park" };
  assert.match(cite(source, "mla"), /^Lee, Ann, et al\. /);
  assert.match(cite(source, "apa"), /^Lee, A\., Chan, B\., & Park, C\. \(2024/);
  assert.match(cite(source, "chicago"), /^Lee, Ann, Bo Chan, and Cy Park\. /);

  const ampersands = { ...FULL, author: "Ann Lee & Bo Chan; Cy Park" };
  assert.deepEqual(parseAuthors(ampersands.author).people.length, 2, "semicolons take precedence as separators");
});

test("very long author lists follow each style's truncation rule", () => {
  // Letters only: bylines containing digits are treated as organizations.
  const letter = (index: number) => String.fromCharCode(65 + index);
  const names = Array.from({ length: 22 }, (_, index) => `Given${letter(index)} Fam${letter(index)}`);
  const source = { ...FULL, author: names.join("; ") };
  const apa = cite(source, "apa");
  assert.match(apa, /^FamA, G\., FamB, G\., .*FamS, G\., \. \. \. FamV, G\. \(2024/);
  assert.equal(apa.includes("FamT"), false);

  const chicago = cite({ ...FULL, author: names.slice(0, 11).join("; ") }, "chicago");
  assert.match(chicago, /^FamA, GivenA, GivenB FamB, .*GivenG FamG, et al\. /);
  assert.equal(chicago.includes("FamH"), false);

  const twentyApa = cite({ ...FULL, author: names.slice(0, 20).join("; ") }, "apa");
  assert.match(twentyApa, /FamS, G\., & FamT, G\. \(2024/);
});

test("a byline equal to the site is a corporate author", () => {
  const source = { ...FULL, author: "BBC News", source: "BBC News" };
  assert.equal(cite(source, "mla"), "“Why Octopuses Are So Smart.” BBC News, 3 May 2024, www.bbc.com/future/article/octopus.");
  assert.equal(
    cite(source, "apa"),
    "BBC News. (2024, May 3). Why Octopuses Are So Smart. https://www.bbc.com/future/article/octopus",
  );
  assert.match(cite(source, "chicago"), /^“Why Octopuses/);
});

test("organization-like and single-word bylines are kept as written", () => {
  assert.match(cite({ ...FULL, author: "Reuters Staff" }, "mla"), /^Reuters Staff\. /);
  assert.match(cite({ ...FULL, author: "Banksy" }, "apa"), /^Banksy\. \(2024/);
  assert.match(cite({ ...FULL, author: "Team 42" }, "chicago"), /^Team 42\. /);
});

test("name suffixes and hyphenated given names", () => {
  const king = { ...FULL, author: "Martin Luther King Jr." };
  assert.match(cite(king, "mla"), /^King, Martin Luther, Jr\. /);
  assert.match(cite(king, "apa"), /^King, M\. L\., Jr\. \(2024/);
  assert.match(cite({ ...FULL, author: "Jean-Paul Sartre" }, "apa"), /^Sartre, J\.-P\. \(2024/);
});

test("site name falls back to the URL host; no URL and no site omits both", () => {
  const hostOnly = { ...FULL, source: null, url: "https://www.example.org/x" };
  assert.match(cite(hostOnly, "mla"), /“Why Octopuses Are So Smart\.” example\.org, 3 May 2024, www\.example\.org\/x\.$/);

  const bare = { title: "No metadata", author: null, source: null, publishedAt: null, url: null };
  assert.equal(cite(bare, "mla"), "“No metadata.” Accessed 17 Nov. 2026.");
  assert.equal(cite(bare, "apa"), "No metadata. (n.d.).");
  assert.equal(cite(bare, "chicago"), "“No metadata.” Accessed November 17, 2026.");

  const dateNoSite = { title: "Dated", publishedAt: "2023-09-14", url: "not a url" };
  assert.equal(cite(dateNoSite, "mla"), "“Dated.” 14 Sept. 2023, not a url.");
  assert.equal(cite(dateNoSite, "chicago"), "“Dated.” September 14, 2023. not a url.");
});

test("titles keep their own terminal punctuation and blank titles get a placeholder", () => {
  assert.match(cite({ ...FULL, title: "Is It Real?" }, "mla"), /“Is It Real\?” /);
  assert.match(cite({ ...FULL, title: "Wow!" }, "apa"), /\)\. Wow! BBC/);
  assert.match(cite({ ...FULL, title: "  " }, "chicago"), /“Untitled article\.”/);
});

test("invalid dates are treated as missing and Date inputs are accepted", () => {
  assert.match(cite({ ...FULL, publishedAt: "not-a-date" }, "apa"), /\(n\.d\.\)/);
  assert.match(cite({ ...FULL, publishedAt: new Date("2020-02-29T23:30:00Z") }, "mla"), /29 Feb\. 2020/);
});

test("formatAllCitations returns every style in display order, defaulting the access date", () => {
  const all = formatAllCitations({ title: "Undated" });
  assert.deepEqual(
    all.map((citation) => citation.style),
    CITATION_STYLES.map((style) => style.id),
  );
  assert.match(all[0]!.text, /Accessed \d{1,2} \w+\.? \d{4}\.$/);
  assert.deepEqual(formatAllCitations(FULL, opts)[1], formatCitation(FULL, "apa", opts));
});

test("articleCitationSource prefers the canonical URL", () => {
  const article = {
    title: "T",
    author: "A B",
    source: "S",
    publishedAt: new Date("2024-01-01T00:00:00Z"),
    canonicalUrl: "https://canonical.example/a",
    sourceUrl: "https://scraped.example/a",
  };
  assert.equal(articleCitationSource(article).url, "https://canonical.example/a");
  assert.equal(articleCitationSource({ ...article, canonicalUrl: null }).url, "https://scraped.example/a");
});

test("parseAuthors handles empty and 'By' bylines", () => {
  assert.deepEqual(parseAuthors(null), { people: [], corporate: false });
  assert.deepEqual(parseAuthors("   "), { people: [], corporate: false });
  assert.deepEqual(parseAuthors("by  Jane   Smith").people, [{ given: "Jane", family: "Smith" }]);
  assert.deepEqual(parseAuthors("bbc news", "BBC News"), { people: [], corporate: true });
});
