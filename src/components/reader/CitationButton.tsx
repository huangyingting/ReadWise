"use client";

/**
 * Reader "Cite" action (#1306): a popover with MLA 9, APA 7, and Chicago
 * citations for the article, each with one-click copy. Copies rich text
 * (italics) where the Clipboard API allows it, plain text otherwise.
 * Citations are formatted on the server and passed in.
 */

import { useRef, useState } from "react";
import { Check, Copy, Quote } from "lucide-react";
import { Button, Popover } from "@/components/ui";
import { CITATION_STYLES, type Citation, type CitationPart } from "@/lib/citations";
import CitationText from "./CitationText";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function citationHtml(parts: CitationPart[]): string {
  return parts.map((part) => (part.italic ? `<i>${escapeHtml(part.text)}</i>` : escapeHtml(part.text))).join("");
}

async function copyCitation(citation: Citation): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([citation.text], { type: "text/plain" }),
          "text/html": new Blob([citationHtml(citation.parts)], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers reject rich clipboard writes; fall back to plain text.
    }
  }
  await navigator.clipboard.writeText(citation.text);
}

export default function CitationButton({ citations }: { citations: Citation[] }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<Citation["style"] | null>(null);
  const [failed, setFailed] = useState(false);

  async function copy(citation: Citation) {
    setFailed(false);
    try {
      await copyCitation(citation);
      setCopied(citation.style);
    } catch {
      setCopied(null);
      setFailed(true);
    }
  }

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        leadingIcon={<Quote size={13} aria-hidden />}
        onClick={() => {
          setOpen((value) => !value);
          setCopied(null);
          setFailed(false);
        }}
      >
        Cite
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label="Cite this article"
        align="start"
        className="w-[min(92vw,420px)] px-[var(--space-4)] py-[var(--space-3)]"
      >
        <div className="flex flex-col gap-[var(--space-4)]">
          {CITATION_STYLES.map(({ id, label }) => {
            const citation = citations.find((entry) => entry.style === id);
            if (!citation) return null;
            return (
              <section key={id} aria-labelledby={`citation-${id}`} className="flex flex-col gap-[var(--space-2)]">
                <div className="flex items-center justify-between gap-[var(--space-2)]">
                  <h3
                    id={`citation-${id}`}
                    className="m-0 text-[length:var(--type-label)] font-semibold uppercase tracking-[var(--tracking-label)] text-text-muted"
                  >
                    {label}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Copy ${label} citation`}
                    leadingIcon={
                      copied === id ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />
                    }
                    onClick={() => void copy(citation)}
                  >
                    {copied === id ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="m-0 select-all break-words text-[length:var(--type-ui)] text-text">
                  <CitationText parts={citation.parts} />
                </p>
              </section>
            );
          })}
          <p role="status" className="m-0 text-[length:var(--type-label)] text-text-muted">
            {failed
              ? "Copy failed — select the citation and copy it manually."
              : copied
                ? "Citation copied."
                : "Check citations against your teacher’s style guide."}
          </p>
        </div>
      </Popover>
    </>
  );
}
