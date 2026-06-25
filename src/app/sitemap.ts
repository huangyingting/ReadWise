import type { MetadataRoute } from "next";
import { listPublishedArticles } from "@/lib/article-library";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
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

  // Include published article URLs so they can be discovered/indexed.
  // The reader is auth-gated, but listing canonical URLs aids discovery and
  // lets social-preview crawlers resolve Open Graph metadata for shared links.
  const articles = await listPublishedArticles(1000);
  const articleRoutes: MetadataRoute.Sitemap = articles.map((article) => ({
    url: `${siteUrl}/reader/${article.id}`,
    // publishedAt may come back as a serialized string from unstable_cache.
    lastModified: article.publishedAt
      ? new Date(article.publishedAt)
      : new Date(article.updatedAt ?? article.createdAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...articleRoutes];
}
