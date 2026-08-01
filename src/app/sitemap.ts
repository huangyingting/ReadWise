import type { MetadataRoute } from "next";
import {
  listPublishedArticleSitemapEntries,
  type PublishedArticleSitemapEntry,
} from "@/lib/article-library";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

function getStaticRoutes(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/signin`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}

async function getPublishedArticlesSafely() {
  // Include published article URLs so they can be discovered/indexed.
  // The reader is auth-gated, but listing canonical URLs aids discovery and
  // lets social-preview crawlers resolve Open Graph metadata for shared links.
  // Gracefully skip article routes when the database is unavailable (e.g.
  // during a cold build without a live database connection).
  try {
    return await listPublishedArticleSitemapEntries(1000);
  } catch {
    // DB unavailable at build time — return only static routes.
    return [];
  }
}

function getArticleRoute(article: PublishedArticleSitemapEntry): MetadataRoute.Sitemap[number] {
  return {
    url: `${siteUrl}/reader/${article.id}`,
    // publishedAt may come back as a serialized string from unstable_cache.
    lastModified: article.publishedAt
      ? new Date(article.publishedAt)
      : new Date(article.updatedAt ?? article.createdAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = getStaticRoutes();
  const articles = await getPublishedArticlesSafely();
  const articleRoutes = articles.map(getArticleRoute);

  return [...staticRoutes, ...articleRoutes];
}
