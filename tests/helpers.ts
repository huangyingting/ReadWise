/**
 * Shared test helpers. These tests run on Node's built-in test runner via the
 * project's TS harness (`scripts/register-ts.mjs`) with experimental module
 * mocking — no external DB or network is ever touched (everything is stubbed).
 */
import {
  ArticleSourceType,
  ArticleStatus,
  ArticleVisibility,
  type Article,
} from "@prisma/client";

/** Azure OpenAI env vars that {@link import("@/lib/ai").isAiConfigured} reads. */
const AI_ENV_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
] as const;

/** Configure the AI provider as "available" for the current process. */
export function enableAi(): void {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-test";
  process.env.AZURE_OPENAI_API_VERSION = "2024-02-01";
}

/** Configure the AI provider as "unconfigured" (graceful-fallback path). */
export function disableAi(): void {
  for (const key of AI_ENV_KEYS) {
    delete process.env[key];
  }
}

/** Builds a serializable Article-like fixture with sensible defaults. */
export function buildArticle(partial: Partial<Article> = {}): Article {
  const now = new Date("2026-01-01T00:00:00Z");
  const base = {
    id: "article-1",
    title: "Test Article",
    author: "Jane Doe",
    source: "Test Source",
    sourceUrl: "https://example.com/a",
    heroImage: null,
    excerpt: "An excerpt.",
    content: "<p>Body</p>",
    category: null,
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    sourceType: ArticleSourceType.SCRAPED,
    difficulty: null,
    difficultyScore: null,
    lexileApprox: null,
    difficultyVersion: null,
    wordCount: null,
    readingMinutes: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ownerId: null,
  };
  return { ...base, ...partial } as unknown as Article;
}

