import { TagIcon } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

export default function TagNotFound() {
  return (
    <SegmentNotFound
      icon={TagIcon}
      title="Tag not found"
      description="We couldn't find that tag. It may not exist yet or the link is incorrect."
    />
  );
}
