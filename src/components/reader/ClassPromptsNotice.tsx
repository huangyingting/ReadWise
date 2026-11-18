"use client";

/**
 * Reader callout for classroom guided prompts (#1307): tells learners their
 * teacher added prompts (shown as numbered, underlined passages) and tells
 * teachers they can add prompts, with a shortcut to the Notes tab.
 */

import { MessageSquareQuote } from "lucide-react";
import { Button, Card, CardBody } from "@/components/ui";
import { useReaderTools } from "@/components/ReaderToolsProvider";
import { useClassAnnotations } from "./ReaderClassAnnotationsProvider";

function promptCount(count: number) {
  return count === 1 ? "1 prompt" : `${count} prompts`;
}

export default function ClassPromptsNotice() {
  const { loaded, teaching, learning, guides } = useClassAnnotations();
  const { openTools } = useReaderTools();
  if (!loaded) return null;

  let message: string | null = null;
  if (teaching.length > 0) {
    message =
      guides.length > 0
        ? `Your class sees ${promptCount(guides.length)} on this article. Add more from your highlights in Notes.`
        : "Guide your class: highlight a passage, then add it as a class prompt from Notes.";
  } else if (learning.length > 0 && guides.length > 0) {
    message = `Your teacher added ${promptCount(guides.length)} to this article. Look for the numbered, underlined passages.`;
  }
  if (!message) return null;

  return (
    <Card className="mb-[var(--space-4)]" aria-label="Class prompts">
      <CardBody className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-start gap-[var(--space-2)] text-[length:var(--type-ui)] text-text">
          <MessageSquareQuote size={16} aria-hidden="true" className="mt-[var(--space-1)] shrink-0 text-primary-text" />
          {message}
        </p>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => openTools("notes")}>
          Open class prompts
        </Button>
      </CardBody>
    </Card>
  );
}
