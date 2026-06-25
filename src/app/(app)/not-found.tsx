import { FileQuestion } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

/**
 * Not-found boundary for the authenticated (app) route group. Living inside the
 * group means bad URLs keep the AppShell (sidebar/header + mobile bottom bar)
 * instead of dropping to the bare root not-found. The root `not-found.tsx`
 * still handles unauthenticated/global 404s.
 */
export default function AppNotFound() {
  return (
    <SegmentNotFound
      icon={FileQuestion}
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
    />
  );
}
