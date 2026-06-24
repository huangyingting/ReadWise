import { ShieldX } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export default function ForbiddenPage() {
  return (
    <main className="container flex items-center justify-center min-h-[60vh]">
      <EmptyState
        icon={ShieldX}
        title="Access denied"
        titleAs="h1"
        description="You don't have permission to access this area. Admin access is required."
        action={{ label: "← Back to dashboard", href: "/dashboard" }}
      />
    </main>
  );
}
