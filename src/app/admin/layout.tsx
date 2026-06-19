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
      <div className="flex items-baseline justify-between gap-[var(--space-4)] flex-wrap mt-[var(--space-6)]">
        <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold">
          Admin
        </h1>
        <Link
          href="/dashboard"
          className="text-text-subtle text-[length:var(--text-sm)] hover:text-text"
        >
          ← Back to dashboard
        </Link>
      </div>
      <AdminNav />
      {children}
    </main>
  );
}
