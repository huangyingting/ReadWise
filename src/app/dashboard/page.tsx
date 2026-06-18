import Link from "next/link";
import Image from "next/image";
import { requireOnboardedSession } from "@/lib/session";
import { listPublishedArticles, filterAndSortByLevel } from "@/lib/articles";
import { getProgressMap } from "@/lib/progress";
import { ensureArticleDifficulties, DIFFICULTY_LEVELS, isDifficultyLevel } from "@/lib/difficulty";
import ArticleCard from "@/components/ArticleCard";
import ListingProgressSync from "@/components/ListingProgressSync";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await requireOnboardedSession("/dashboard");
  const user = session.user;

  const { level } = await searchParams;
  const activeLevel = isDifficultyLevel(level) ? level : null;

  const articles = await listPublishedArticles();
  await ensureArticleDifficulties(articles);
  const visibleArticles = filterAndSortByLevel(articles, activeLevel);
  const progressMap = await getProgressMap(
    user.id,
    visibleArticles.map((a) => a.id),
  );

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <div className="card stack" style={{ marginTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? "avatar"}
              width={56}
              height={56}
              style={{ borderRadius: "50%" }}
            />
          ) : null}
          <div>
            <div>
              <strong>{user.name ?? "Unnamed reader"}</strong>
            </div>
            <div className="muted">{user.email}</div>
            <div className="muted">Role: {user.role}</div>
          </div>
        </div>
      </div>
      {user.role === "Admin" ? (
        <p style={{ marginTop: "1.5rem" }}>
          <Link className="btn btn-primary" href="/admin">
            Admin dashboard
          </Link>
        </p>
      ) : null}

      <section style={{ marginTop: "2rem" }}>
        <h2>Continue reading</h2>
        <form
          method="get"
          className="level-filter"
          style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.75rem 0" }}
        >
          <label htmlFor="level" className="muted" style={{ fontSize: "0.9rem" }}>
            English level
          </label>
          <select id="level" name="level" defaultValue={activeLevel ?? ""}>
            <option value="">All levels</option>
            {DIFFICULTY_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl} and below
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Apply
          </button>
          {activeLevel ? (
            <Link href="/dashboard" className="muted" style={{ fontSize: "0.85rem" }}>
              Clear
            </Link>
          ) : null}
        </form>
        {visibleArticles.length === 0 ? (
          <p className="muted">
            {articles.length === 0
              ? "No articles available yet."
              : "No articles match this level yet."}
          </p>
        ) : (
          <div className="article-grid">
            {visibleArticles.map((article) => {
              const progress = progressMap.get(article.id);
              return (
                <ArticleCard
                  key={article.id}
                  article={article}
                  progress={
                    progress
                      ? {
                          percent: progress.percent,
                          completed: progress.completed,
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
        <ListingProgressSync articleIds={visibleArticles.map((a) => a.id)} />
      </section>

      <p style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
        <Link href="/">← Back home</Link>
        <Link href="/study">Study list</Link>
        <Link href="/settings">Settings</Link>
        <SignOutButton />
      </p>
    </main>
  );
}
