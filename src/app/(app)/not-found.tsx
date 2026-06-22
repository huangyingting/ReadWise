import { FileQuestion } from "lucide-react";
import EmptyState from "@/components/EmptyState";

/**
 * Not-found boundary for the authenticated (app) route group. Living inside the
 * group means bad URLs keep the AppShell (sidebar/header + mobile bottom bar)
 * instead of dropping to the bare root not-found. The root `not-found.tsx`
 * still handles unauthenticated/global 404s.
 */
export default function AppNotFound() {
  return (
    <main className="flex items-center justify-center min-h-[60vh] px-[var(--space-6)]">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        action={{ label: "← Back to dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
