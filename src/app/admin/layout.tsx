import Link from "next/link";
import AdminNav from "@/components/AdminNav";

/**
 * Admin layout — sync, no `await requireAdmin()` here.
 *
 * Each admin page calls `requireAdmin()` individually (defence-in-depth).
 * Making the layout async created a second streaming Suspense boundary that
 * raced with the page-level boundary and left the streaming container (#S:N)
 * visible, duplicating the stat-card grid in the DOM (#51).
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="container">
      <div className="flex items-baseline justify-between gap-[var(--space-4)] flex-wrap mt-[var(--space-6)]">
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
