import Link from "next/link";
import Image from "next/image";
import { requireOnboardedSession } from "@/lib/session";
import { listPublishedArticles } from "@/lib/articles";
import { getProgressMap } from "@/lib/progress";
import ArticleCard from "@/components/ArticleCard";
import ListingProgressSync from "@/components/ListingProgressSync";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage() {
  const session = await requireOnboardedSession("/dashboard");
  const user = session.user;

  const articles = await listPublishedArticles();
  const progressMap = await getProgressMap(
    user.id,
    articles.map((a) => a.id),
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
        {articles.length === 0 ? (
          <p className="muted">No articles available yet.</p>
        ) : (
          <div className="article-grid">
            {articles.map((article) => {
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
        <ListingProgressSync articleIds={articles.map((a) => a.id)} />
      </section>

      <p style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
        <Link href="/">← Back home</Link>
        <Link href="/settings">Settings</Link>
        <SignOutButton />
      </p>
    </main>
  );
}
