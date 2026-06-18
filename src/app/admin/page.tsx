import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  const session = await requireAdmin("/admin");

  const [users, admins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "Admin" } }),
  ]);

  return (
    <main className="container">
      <h1>Admin</h1>
      <p className="muted">
        Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
        ({session.user.role})
      </p>

      <div className="card stack" style={{ marginTop: "1.5rem" }}>
        <div>
          <strong>{users}</strong> total members
        </div>
        <div>
          <strong>{admins}</strong> admins
        </div>
      </div>

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
    </main>
  );
}
