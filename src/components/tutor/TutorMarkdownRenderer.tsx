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

function renderInlineTokens(tokens: InlineToken[], prefix: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${prefix}-${i}`;
    if (tok.type === "bold") return <strong key={key}>{tok.value}</strong>;
    if (tok.type === "code") return <code key={key}>{tok.value}</code>;
    // type === "text": plain string — React escapes it automatically (XSS-safe)
    return tok.value;
  });
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
      {blocks.map((block, bi) => {
        if (block.type === "ul") {
          return (
            <ul key={bi}>
              {block.items.map((tokens, li) => (
                <li key={li}>{renderInlineTokens(tokens, `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={bi}>
              {block.items.map((tokens, li) => (
                <li key={li}>{renderInlineTokens(tokens, `${bi}-${li}`)}</li>
              ))}
            </ol>
          );
        }
        // paragraph
        const children: ReactNode[] = [];
        block.lines.forEach((lineTokens, li) => {
          if (li > 0) children.push(<br key={`br-${li}`} />);
          children.push(...renderInlineTokens(lineTokens, `${bi}-p${li}`));
        });
        return <p key={bi}>{children}</p>;
      })}
    </div>
  );
}
