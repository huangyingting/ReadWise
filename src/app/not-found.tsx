import { FileQuestion } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export default function NotFound() {
  return (
    <main className="flex items-center justify-center min-h-[60vh] px-[var(--space-6)]">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        action={{ label: "← Back to Dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
