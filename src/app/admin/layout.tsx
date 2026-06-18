import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import AdminNav from "@/components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin("/admin");

  return (
    <main className="container">
      <div className="admin-header">
        <h1 style={{ margin: 0 }}>Admin</h1>
        <Link href="/dashboard" className="muted">
          ← Back to dashboard
        </Link>
      </div>
      <AdminNav />
      {children}
    </main>
  );
}
