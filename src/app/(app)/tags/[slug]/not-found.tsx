import { TagIcon } from "lucide-react";
import { SegmentNotFound } from "@/components/route-states";

const TAG_NOT_FOUND_COPY = {
  title: "Tag not found",
  description:
    "We couldn't find that tag. It may not exist yet or the link is incorrect.",
};

export default function TagNotFound() {
  return (
    <SegmentNotFound
      icon={TagIcon}
      title={TAG_NOT_FOUND_COPY.title}
      description={TAG_NOT_FOUND_COPY.description}
    />
  );
}
