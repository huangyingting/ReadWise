import { requireAdmin } from "@/lib/session";

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");
  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2>Analytics</h2>
      <p className="muted">Analytics are coming soon.</p>
    </section>
  );
}
