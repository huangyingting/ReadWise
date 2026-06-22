import { TagIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export default function TagNotFound() {
  return (
    <main className="flex items-center justify-center min-h-[60vh] px-[var(--space-6)]">
      <EmptyState
        icon={TagIcon}
        title="Tag not found"
        description="We couldn't find that tag. It may not exist yet or the link is incorrect."
        action={{ label: "← Back to dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
