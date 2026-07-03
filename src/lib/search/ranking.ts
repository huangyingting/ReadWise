/**
 * Candidate types, scoring, and ranking for article search results.
 *
 * This module is intentionally free of the Prisma client instance so that
 * ranking logic can be unit-tested without any database dependency.
 */
import { type Article } from "@prisma/client";

export type SearchSource = "article" | "highlight" | "savedWord";

export type SearchCandidate = {
  article: Article;
  sources: Set<SearchSource>;
};

const FIELD_WEIGHTS = {
  title: 60,
  excerpt: 28,
  author: 22,
  source: 22,
  category: 12,
  content: 10,
} as const;

const SOURCE_BOOSTS = {
  highlight: 45,
  savedWord: 35,
  owner: 20,
} as const;

function recencyTime(article: Pick<Article, "publishedAt" | "createdAt">): number {
  return (article.publishedAt ?? article.createdAt).getTime();
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function fieldScore(value: string | null | undefined, query: string, terms: string[], weight: number): number {
  const haystack = lower(value);
  if (!haystack) return 0;
  let score = haystack.includes(query) ? weight * 2 : 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += weight;
  }
  return score;
}

export function scoreArticleSearchCandidate(
  article: Article,
  query: string,
  terms: string[],
  sources: Iterable<SearchSource>,
): number {
  const sourceSet = sources instanceof Set ? sources : new Set(sources);
  let score = 0;
  score += fieldScore(article.title, query, terms, FIELD_WEIGHTS.title);
  score += fieldScore(article.excerpt, query, terms, FIELD_WEIGHTS.excerpt);
  score += fieldScore(article.author, query, terms, FIELD_WEIGHTS.author);
  score += fieldScore(article.source, query, terms, FIELD_WEIGHTS.source);
  score += fieldScore(article.category, query, terms, FIELD_WEIGHTS.category);
  score += fieldScore(article.content, query, terms, FIELD_WEIGHTS.content);
  if (sourceSet.has("highlight")) score += SOURCE_BOOSTS.highlight;
  if (sourceSet.has("savedWord")) score += SOURCE_BOOSTS.savedWord;
  if (article.ownerId) score += SOURCE_BOOSTS.owner;
  return score;
}

export function putCandidate(
  candidates: Map<string, SearchCandidate>,
  article: Article,
  source: SearchSource,
): void {
  const existing = candidates.get(article.id);
  if (existing) {
    existing.sources.add(source);
    return;
  }
  candidates.set(article.id, { article, sources: new Set([source]) });
}

export function sortCandidates(candidates: SearchCandidate[], query: string, terms: string[]): SearchCandidate[] {
  return candidates.sort((a, b) => {
    const scoreDiff =
      scoreArticleSearchCandidate(b.article, query, terms, b.sources) -
      scoreArticleSearchCandidate(a.article, query, terms, a.sources);
    if (scoreDiff !== 0) return scoreDiff;
    const dateDiff = recencyTime(b.article) - recencyTime(a.article);
    if (dateDiff !== 0) return dateDiff;
    return a.article.title.localeCompare(b.article.title);
  });
}
