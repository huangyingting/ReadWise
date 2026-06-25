import { FileQuestion } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

export default function ArticleNotFound() {
  return (
    <SegmentNotFound
      icon={FileQuestion}
      title="Article not found"
      description="We couldn't find that article. It may have been removed or the link is incorrect."
    />
  );
}
