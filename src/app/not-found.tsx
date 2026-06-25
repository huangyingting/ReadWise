import { FileQuestion } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

export default function NotFound() {
  return (
    <SegmentNotFound
      icon={FileQuestion}
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
    />
  );
}
