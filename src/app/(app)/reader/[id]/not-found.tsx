import { FileQuestion } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export default function ArticleNotFound() {
  return (
    <main className="flex items-center justify-center min-h-[60vh] px-[var(--space-6)]">
      <EmptyState
        icon={FileQuestion}
        title="Article not found"
        description="We couldn't find that article. It may have been removed or the link is incorrect."
        action={{ label: "← Back to dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
