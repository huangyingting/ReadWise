import { FileQuestion } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

const NOT_FOUND_COPY = {
  title: "Page not found",
  description: "The page you're looking for doesn't exist or has been moved.",
};

export default function NotFound() {
  return (
    <SegmentNotFound
      icon={FileQuestion}
      title={NOT_FOUND_COPY.title}
      description={NOT_FOUND_COPY.description}
    />
  );
}
