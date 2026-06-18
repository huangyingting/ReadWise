import { requireAdmin } from "@/lib/session";

export default async function AdminArticlesPage() {
  await requireAdmin("/admin/articles");
  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2>Articles</h2>
      <p className="muted">Article management is coming soon.</p>
    </section>
  );
}
