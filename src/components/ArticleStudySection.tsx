"use client";

/**
 * ArticleStudySection (#153 — in-flow anchor/CTA)
 *
 * Previously this owned the practice-tools tab system in page flow. After #153
 * the six tools live in a SINGLE mounted instance inside <ReaderToolsSurface>
 * (right rail on xl / bottom sheet on <xl), reachable from the sticky toolbar at
 * any scroll position.
 *
 * This component is now the SSR-rendered, in-flow scroll anchor that keeps the
 * tools server-reachable and discoverable mid/after-read: a compact "Practice
 * what you read" section whose buttons OPEN the surface (optionally jumping to a
 * specific tool). It mounts no tool components itself — so there are no duplicate
 * network fetches.
 */

import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { useReaderTools } from "./ReaderToolsProvider";
import { TOOL_TABS } from "./ReaderTools";

export default function ArticleStudySection() {
  const { openTools } = useReaderTools();

  return (
    <section
      id="practice-tools"
      className="article-study"
      aria-label="Practice and study"
    >
      <h2 className="article-study-title">Practice what you read</h2>
      <p className="muted article-study-subtitle">
        Reinforce the article with vocabulary, a quiz, listening &amp; speaking
        practice, your notes, and an AI tutor — open the tools beside the article
        any time.
      </p>

      <div className="article-study-cta">
        <Button
          type="button"
          variant="primary"
          onClick={() => openTools()}
          aria-haspopup="dialog"
          aria-controls="reader-tools-surface"
        >
          Open practice tools
        </Button>

        <div className="article-study-cta-chips" aria-label="Jump to a tool">
          {TOOL_TABS.map(({ id, label, icon, hint }) => (
            <button
              key={id}
              type="button"
              title={hint}
              onClick={() => openTools(id)}
              aria-haspopup="dialog"
              aria-controls="reader-tools-surface"
              className={cn("article-study-cta-chip", focusRing)}
            >
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
