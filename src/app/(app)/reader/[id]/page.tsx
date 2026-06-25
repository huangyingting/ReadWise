import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { safeJsonStringify } from "@/lib/safe-json";
import { requireSession } from "@/lib/session";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-library";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { loadReaderPageData, buildArticleJsonLd } from "@/lib/reader/page-loader";
import ReaderProgress from "@/components/ReaderProgress";
import ReaderShell from "./ReaderShell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Use a non-throwing session read so unauthenticated crawlers get the
  // generic fallback title (no redirect/crash). Authenticated owners can then
  // see titles of their private articles in the <title> tag.
  const session = await getServerSession(authOptions);
  const article = await getReadableArticleById(id, articleAccessContext(session?.user ?? null));
  if (!article) {
    return { title: "Article" };
  }

  const description = articleHtmlToReaderText(article.content)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return {
    title: article.title,
    description,
    openGraph: {
      type: "article",
      title: article.title,
      description,
      ...(article.author ? { authors: [article.author] } : {}),
      ...(article.publishedAt
        ? { publishedTime: new Date(article.publishedAt).toISOString() }
        : {}),
      ...(article.heroImage ? { images: [article.heroImage] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      ...(article.heroImage ? { images: [article.heroImage] } : {}),
    },
  };
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/reader/${id}`);
  const data = await loadReaderPageData(id, session);
  if (!data) {
    notFound();
  }

  const jsonLd = buildArticleJsonLd(data.article, data.articlePlainText);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonStringify(jsonLd) }}
      />
      {/* Reading progress — fixed top bar, z-50, forward-only. Lives OUTSIDE the
          client providers so it does NOT create an extra Suspense boundary that
          could conflict with the route-segment loading.tsx skeleton. */}
      <ReaderProgress
        articleId={data.article.id}
        initialPercent={data.progress?.percent ?? 0}
      />
      <ReaderShell data={data} />
    </>
  );
}
