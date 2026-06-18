import { requireAdmin } from "@/lib/session";

export default async function AdminTagsPage() {
  await requireAdmin("/admin/tags");
  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2>Tags</h2>
      <p className="muted">Tag management is coming soon.</p>
    </section>
  );
}
