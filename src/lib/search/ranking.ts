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
  score += fieldScore(article.title, query, terms, 60);
  score += fieldScore(article.excerpt, query, terms, 28);
  score += fieldScore(article.author, query, terms, 22);
  score += fieldScore(article.source, query, terms, 22);
  score += fieldScore(article.category, query, terms, 12);
  score += fieldScore(article.content, query, terms, 10);
  if (sourceSet.has("highlight")) score += 45;
  if (sourceSet.has("savedWord")) score += 35;
  if (article.ownerId) score += 20;
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
