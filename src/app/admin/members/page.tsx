import { requireAdmin } from "@/lib/session";

export default async function AdminMembersPage() {
  await requireAdmin("/admin/members");
  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2>Members</h2>
      <p className="muted">Member management is coming soon.</p>
    </section>
  );
}
