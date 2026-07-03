"use client";

/**
 * TutorMarkdownRenderer
 *
 * Safe tutor markdown renderer — text-only, no HTML path.
 *
 * XSS safety guarantee: every leaf is a React {string} child.
 * No dangerouslySetInnerHTML, no HTML path from model text to DOM.
 * The underlying tokenizer (tutor-markdown) represents all model text as
 * typed tokens; React escapes string children automatically.
 */

import type { ReactNode } from "react";
import { tokenizeBlocks, type Block, type InlineToken } from "@/lib/tutor-markdown";

type ListBlock = Extract<Block, { type: "ul" | "ol" }>;
type ParagraphBlock = Extract<Block, { type: "paragraph" }>;

function renderInlineTokens(tokens: InlineToken[], prefix: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${prefix}-${i}`;
    switch (tok.type) {
      case "bold":
        return <strong key={key}>{tok.value}</strong>;
      case "code":
        return <code key={key}>{tok.value}</code>;
      case "text":
        // Plain string — React escapes it automatically (XSS-safe).
        return tok.value;
    }
  });
}

function renderListItems(block: ListBlock, blockIndex: number): ReactNode[] {
  return block.items.map((tokens, itemIndex) => (
    <li key={itemIndex}>
      {renderInlineTokens(tokens, `${blockIndex}-${itemIndex}`)}
    </li>
  ));
}

function renderParagraph(block: ParagraphBlock, blockIndex: number): ReactNode {
  const children: ReactNode[] = [];

  block.lines.forEach((lineTokens, lineIndex) => {
    if (lineIndex > 0) children.push(<br key={`br-${lineIndex}`} />);
    children.push(...renderInlineTokens(lineTokens, `${blockIndex}-p${lineIndex}`));
  });

  return <p key={blockIndex}>{children}</p>;
}

function renderBlock(block: Block, blockIndex: number): ReactNode {
  switch (block.type) {
    case "ul":
      return <ul key={blockIndex}>{renderListItems(block, blockIndex)}</ul>;
    case "ol":
      return <ol key={blockIndex}>{renderListItems(block, blockIndex)}</ol>;
    case "paragraph":
      return renderParagraph(block, blockIndex);
  }
}

/**
 * Render markdown-light content as safe React elements.
 *
 * Input is tokenized by `tokenizeBlocks`; every output leaf is a plain
 * React string child — no dangerouslySetInnerHTML anywhere in this path.
 */
export function TutorMarkdownRenderer({ content }: { content: string }): ReactNode {
  const blocks = tokenizeBlocks(content);
  return (
    <div className="rw-tutor-answer">
      {blocks.map(renderBlock)}
    </div>
  );
}
