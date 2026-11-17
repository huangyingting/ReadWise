/**
 * Deterministic academic citations for articles (#1306): MLA 9, APA 7, and
 * Chicago (17th, notes-bibliography entry) for an online news/web article.
 *
 * Pure and client-safe. Output is a list of parts so callers can render or
 * copy italics (`parts`) as well as plain text (`text`). Dates are formatted in
 * UTC so server and client agree. Titles are kept as published (no automatic
 * sentence/title casing — proper nouns cannot be detected reliably).
 *
 * Missing data degrades the way each style prescribes:
 *   - no author → the entry starts with the title (APA moves the title into the
 *     author position); an author equal to the site name is treated as a
 *     corporate author and omitted in MLA/Chicago to avoid repeating it.
 *   - no publish date → MLA/Chicago add an access date, APA uses "(n.d.)" with
 *     a "Retrieved … from" retrieval statement.
 *   - no site name → derived from the URL host; omitted when there is no URL.
 */

import type { Article } from "@prisma/client";

export type CitationStyle = "mla" | "apa" | "chicago";

export const CITATION_STYLES: ReadonlyArray<{ id: CitationStyle; label: string }> = [
  { id: "mla", label: "MLA 9" },
  { id: "apa", label: "APA 7" },
  { id: "chicago", label: "Chicago" },
];

export type CitationSource = {
  title: string;
  author?: string | null;
  /** Publication / website name (`Article.source`). */
  source?: string | null;
  publishedAt?: Date | string | null;
  /** Prefer the canonical upstream URL, then the scraped source URL. */
  url?: string | null;
};

/** Citation metadata for an article: the canonical URL wins over the scraped one. */
export function articleCitationSource(
  article: Pick<Article, "title" | "author" | "source" | "publishedAt" | "canonicalUrl" | "sourceUrl">,
): CitationSource {
  return {
    title: article.title,
    author: article.author,
    source: article.source,
    publishedAt: article.publishedAt,
    url: article.canonicalUrl ?? article.sourceUrl,
  };
}

export type CitationPart = { text: string; italic?: boolean };

export type Citation = { style: CitationStyle; parts: CitationPart[]; text: string };

type Person = { given: string; family: string } | { literal: string };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** MLA abbreviates months longer than four letters. */
const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const NAME_SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
const ORGANIZATION_WORDS =
  /\b(news|staff|team|desk|editors?|editorial|agency|press|wire|reporters?|correspondents?|foundation|institute|university|association|society|council|bureau|department|ministry|magazine|media|bbc|reuters|ap)\b/i;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Appends `mark` unless the text already ends in terminal punctuation. */
function terminate(text: string, mark = "."): string {
  return /[.!?]$/.test(text) ? text : `${text}${mark}`;
}

function siteFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

function parsePerson(name: string): Person {
  const tokens = name.split(" ").filter(Boolean);
  if (tokens.length < 2 || ORGANIZATION_WORDS.test(name) || /\d/.test(name)) return { literal: name };
  let suffix = "";
  if (tokens.length > 2 && NAME_SUFFIXES.test(tokens[tokens.length - 1]!)) {
    suffix = `, ${tokens.pop()}`;
  }
  const family = tokens.pop()!;
  return { given: tokens.join(" ") + suffix, family };
}

/**
 * Splits a byline into people. Handles a leading "By", "and"/"&" joins, and
 * comma or semicolon lists ("A, B, and C"). An author identical to the site
 * name is a corporate author and is dropped (`corporate: true`).
 */
export function parseAuthors(
  raw: string | null | undefined,
  siteName?: string | null,
): { people: Person[]; corporate: boolean } {
  const byline = clean(raw).replace(/^by\s+/i, "");
  if (!byline) return { people: [], corporate: false };
  if (siteName && byline.toLowerCase() === clean(siteName).toLowerCase()) {
    return { people: [], corporate: true };
  }
  const separator = byline.includes(";") ? /\s*;\s*(?:and\s+)?/i : /\s*(?:,\s*and\s+|,\s*&\s*|\s+and\s+|\s*&\s*|,\s*)/i;
  const names = byline.split(separator).map(clean).filter(Boolean);
  return { people: names.map(parsePerson), corporate: false };
}

function invertedName(person: Person): string {
  return "literal" in person ? person.literal : `${person.family}, ${person.given}`;
}

function naturalName(person: Person): string {
  return "literal" in person ? person.literal : `${person.given} ${person.family}`;
}

function apaName(person: Person): string {
  if ("literal" in person) return person.literal;
  const [given, suffix] = person.given.split(", ");
  const initials = given!
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((piece) => `${piece.charAt(0).toUpperCase()}.`)
        .join("-"),
    )
    .join(" ");
  return `${person.family}, ${initials}${suffix ? `, ${suffix}` : ""}`;
}

function mlaAuthors(people: Person[]): string | null {
  if (people.length === 0) return null;
  if (people.length === 1) return invertedName(people[0]!);
  if (people.length === 2) return `${invertedName(people[0]!)}, and ${naturalName(people[1]!)}`;
  return `${invertedName(people[0]!)}, et al`;
}

function apaAuthors(people: Person[]): string | null {
  if (people.length === 0) return null;
  const names = people.map(apaName);
  if (names.length === 1) return names[0]!;
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
}

function chicagoAuthors(people: Person[]): string | null {
  if (people.length === 0) return null;
  if (people.length === 1) return invertedName(people[0]!);
  if (people.length > 10) {
    return `${invertedName(people[0]!)}, ${people.slice(1, 7).map(naturalName).join(", ")}, et al`;
  }
  const rest = people.slice(1).map(naturalName);
  const last = rest.pop()!;
  // The inverted first name always needs the serial comma ("Smith, Jane, and John Doe").
  return `${[invertedName(people[0]!), ...rest].join(", ")}, and ${last}`;
}

function mlaDate(date: Date): string {
  return `${date.getUTCDate()} ${MLA_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function longDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function withoutScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function quotedTitle(title: string): string {
  return `“${terminate(title)}”`;
}

function build(style: CitationStyle, parts: CitationPart[]): Citation {
  const merged = parts.filter((part) => part.text.length > 0);
  return { style, parts: merged, text: merged.map((part) => part.text).join("") };
}

function mla(source: Normalized, accessedAt: Date): Citation {
  const author = mlaAuthors(source.people);
  const parts: CitationPart[] = [];
  if (author) parts.push({ text: `${terminate(author)} ` });
  parts.push({ text: quotedTitle(source.title) });
  const container: string[] = [];
  if (source.published) container.push(mlaDate(source.published));
  if (source.url) container.push(withoutScheme(source.url));
  if (source.site) {
    parts.push({ text: " " }, { text: source.site, italic: true });
    parts.push({ text: container.length > 0 ? `, ${container.join(", ")}.` : "." });
  } else if (container.length > 0) {
    parts.push({ text: ` ${container.join(", ")}.` });
  }
  if (!source.published) parts.push({ text: ` Accessed ${mlaDate(accessedAt)}.` });
  return build("mla", parts);
}

function italicTitle(title: string): CitationPart[] {
  return [{ text: title, italic: true }, { text: /[.!?]$/.test(title) ? "" : "." }];
}

function apa(source: Normalized, accessedAt: Date): Citation {
  // APA keeps a corporate author (byline = site) and then drops the site name.
  const author = apaAuthors(source.people) ?? (source.corporate ? source.site : null);
  const published = source.published;
  const date = published
    ? `(${published.getUTCFullYear()}, ${MONTHS[published.getUTCMonth()]} ${published.getUTCDate()})`
    : "(n.d.)";
  const parts: CitationPart[] = [];
  if (author) {
    parts.push({ text: `${terminate(author)} ${date}. ` }, ...italicTitle(source.title));
  } else {
    parts.push(...italicTitle(source.title), { text: ` ${date}.` });
  }
  if (source.site && source.site !== author) parts.push({ text: ` ${terminate(source.site)}` });
  if (source.url) {
    parts.push({
      text: published ? ` ${source.url}` : ` Retrieved ${longDate(accessedAt)}, from ${source.url}`,
    });
  }
  return build("apa", parts);
}

function chicago(source: Normalized, accessedAt: Date): Citation {
  const author = chicagoAuthors(source.people);
  const parts: CitationPart[] = [];
  if (author) parts.push({ text: `${terminate(author)} ` });
  parts.push({ text: quotedTitle(source.title) });
  if (source.site) {
    parts.push({ text: " " }, { text: source.site, italic: true });
    parts.push({ text: source.published ? `, ${longDate(source.published)}.` : "." });
  } else if (source.published) {
    parts.push({ text: ` ${longDate(source.published)}.` });
  }
  if (!source.published) parts.push({ text: ` Accessed ${longDate(accessedAt)}.` });
  if (source.url) parts.push({ text: ` ${source.url}.` });
  return build("chicago", parts);
}

type Normalized = {
  title: string;
  people: Person[];
  /** The byline was the site itself (a corporate author). */
  corporate: boolean;
  site: string | null;
  published: Date | null;
  url: string | null;
};

function normalize(input: CitationSource): Normalized {
  const url = clean(input.url) || null;
  const site = clean(input.source) || siteFromUrl(url);
  const { people, corporate } = parseAuthors(input.author, site);
  return {
    title: clean(input.title) || "Untitled article",
    people,
    corporate,
    site,
    published: toDate(input.publishedAt),
    url,
  };
}

const FORMATTERS: Record<CitationStyle, (source: Normalized, accessedAt: Date) => Citation> = {
  mla,
  apa,
  chicago,
};

/** Formats one citation; `accessedAt` defaults to now. */
export function formatCitation(
  input: CitationSource,
  style: CitationStyle,
  options: { accessedAt?: Date } = {},
): Citation {
  return FORMATTERS[style](normalize(input), options.accessedAt ?? new Date());
}

/** All supported styles, in display order. */
export function formatAllCitations(input: CitationSource, options: { accessedAt?: Date } = {}): Citation[] {
  return CITATION_STYLES.map(({ id }) => formatCitation(input, id, options));
}
