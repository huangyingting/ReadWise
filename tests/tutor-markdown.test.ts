/**
 * Tests for src/lib/tutor-markdown.ts
 *
 * Key goal: verify that assistant answers containing HTML/script-like text
 * are tokenized as plain text — not as executable HTML — proving the XSS-safe
 * rendering contract. The rendering layer in ArticleTutor.tsx maps these tokens
 * to React {string} children which React escapes automatically.
 *
 * No DB, network, or DOM required — pure tokenizer logic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizeInline, tokenizeBlocks } from "@/lib/tutor-markdown";
import type { InlineToken, Block } from "@/lib/tutor-markdown";

// ---------------------------------------------------------------------------
// Helper: flatten all text values from a token array
// ---------------------------------------------------------------------------
function joinTokenText(tokens: InlineToken[]): string {
  return tokens.map((t) => t.value).join("");
}

function extractBlockText(block: Block): string {
  if (block.type === "paragraph") {
    return block.lines.map((line) => joinTokenText(line)).join("\n");
  }
  if (block.type === "ul" || block.type === "ol") {
    return block.items.map((item) => joinTokenText(item)).join("\n");
  }
  return "";
}

function hasTokenType(tokens: InlineToken[], type: string): boolean {
  return tokens.some((t) => t.type === type);
}

// ---------------------------------------------------------------------------
// XSS safety — the critical contract
// ---------------------------------------------------------------------------

describe("XSS safety — HTML/script input renders as literal text", () => {
  test("script tag becomes a plain text token, never a 'script' element type", () => {
    const input = '<script>alert("xss")</script>';
    const blocks = tokenizeBlocks(input);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph");
    const para = blocks[0] as Extract<Block, { type: "paragraph" }>;
    // Must be a single text token with the literal string
    const tokens = para.lines[0];
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.equal(tokens[0].value, input);
  });

  test("img onerror payload stays as plain text", () => {
    const input = '<img src=x onerror="alert(1)">';
    const blocks = tokenizeBlocks(input);
    const para = blocks[0] as Extract<Block, { type: "paragraph" }>;
    const text = joinTokenText(para.lines[0]);
    assert.equal(text, input, "img tag is literal text");
    // No bold or code token produced
    assert.ok(!hasTokenType(para.lines[0], "bold"));
    assert.ok(!hasTokenType(para.lines[0], "code"));
  });

  test("HTML entity-like text is not interpreted", () => {
    const input = "&lt;script&gt;alert(1)&lt;/script&gt;";
    const blocks = tokenizeBlocks(input);
    const para = blocks[0] as Extract<Block, { type: "paragraph" }>;
    assert.equal(joinTokenText(para.lines[0]), input);
  });

  test("nested HTML inside **bold** markers stays as bold value text only", () => {
    // The bold parser extracts the raw text between **...**
    // even if it looks like HTML — it's still just a string, never parsed
    const input = "**<em>bold and evil</em>**";
    const tokens = tokenizeInline(input);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "bold");
    assert.equal(tokens[0].value, "<em>bold and evil</em>");
  });

  test("javascript: URL in text is treated as literal text", () => {
    const input = 'Click here: javascript:alert("xss")';
    const tokens = tokenizeInline(input);
    // The whole string is one text token (no markdown matches)
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.ok(tokens[0].value.includes("javascript:"));
  });
});

// ---------------------------------------------------------------------------
// Inline tokenizer — correct parsing
// ---------------------------------------------------------------------------

describe("tokenizeInline — inline markdown parsing", () => {
  test("plain text returns a single text token", () => {
    const tokens = tokenizeInline("Hello, world!");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.equal(tokens[0].value, "Hello, world!");
  });

  test("**bold** produces a bold token", () => {
    const tokens = tokenizeInline("This is **bold** text.");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].type, "text");
    assert.equal(tokens[0].value, "This is ");
    assert.equal(tokens[1].type, "bold");
    assert.equal(tokens[1].value, "bold");
    assert.equal(tokens[2].type, "text");
    assert.equal(tokens[2].value, " text.");
  });

  test("`code` produces a code token", () => {
    const tokens = tokenizeInline("Use `console.log()` here.");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[1].type, "code");
    assert.equal(tokens[1].value, "console.log()");
  });

  test("bold and code can coexist in the same line", () => {
    const tokens = tokenizeInline("**important** and `code`");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].type, "bold");
    assert.equal(tokens[0].value, "important");
    assert.equal(tokens[1].type, "text");
    assert.equal(tokens[2].type, "code");
    assert.equal(tokens[2].value, "code");
  });

  test("empty string returns single empty text token", () => {
    const tokens = tokenizeInline("");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.equal(tokens[0].value, "");
  });

  test("unmatched ** is treated as plain text", () => {
    const tokens = tokenizeInline("this ** is not closed");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.ok(tokens[0].value.includes("**"));
  });
});

// ---------------------------------------------------------------------------
// Block tokenizer — structure
// ---------------------------------------------------------------------------

describe("tokenizeBlocks — block structure parsing", () => {
  test("single paragraph returns one paragraph block", () => {
    const blocks = tokenizeBlocks("This is a sentence.");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph");
  });

  test("two blank-line-separated chunks produce two paragraph blocks", () => {
    const blocks = tokenizeBlocks("First paragraph.\n\nSecond paragraph.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, "paragraph");
    assert.equal(blocks[1].type, "paragraph");
  });

  test("- list lines produce a ul block", () => {
    const blocks = tokenizeBlocks("- Item one\n- Item two\n- Item three");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "ul");
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    assert.equal(ul.items.length, 3);
    assert.equal(joinTokenText(ul.items[0]), "Item one");
    assert.equal(joinTokenText(ul.items[1]), "Item two");
  });

  test("• bullet list produces a ul block", () => {
    const blocks = tokenizeBlocks("• First\n• Second");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "ul");
  });

  test("numbered list produces an ol block", () => {
    const blocks = tokenizeBlocks("1. First\n2. Second\n3. Third");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "ol");
    const ol = blocks[0] as Extract<Block, { type: "ol" }>;
    assert.equal(ol.items.length, 3);
    assert.equal(joinTokenText(ol.items[0]), "First");
  });

  test("mixed list + paragraph text stays as a paragraph block", () => {
    // Not all lines are list items → falls back to paragraph
    const blocks = tokenizeBlocks("- Item\nBut this is not a list item");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph");
  });

  test("empty input returns no blocks", () => {
    const blocks = tokenizeBlocks("");
    assert.equal(blocks.length, 0);
  });

  test("whitespace-only input returns no blocks", () => {
    const blocks = tokenizeBlocks("   \n\n   ");
    assert.equal(blocks.length, 0);
  });

  test("multi-line paragraph preserves individual lines", () => {
    const blocks = tokenizeBlocks("Line one\nLine two\nLine three");
    assert.equal(blocks.length, 1);
    const para = blocks[0] as Extract<Block, { type: "paragraph" }>;
    assert.equal(para.lines.length, 3);
    assert.equal(joinTokenText(para.lines[0]), "Line one");
    assert.equal(joinTokenText(para.lines[2]), "Line three");
  });

  test("bold inside a list item is tokenized correctly", () => {
    const blocks = tokenizeBlocks("- **Key** point\n- Another point");
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    const firstItem = ul.items[0];
    assert.equal(firstItem[0].type, "bold");
    assert.equal(firstItem[0].value, "Key");
    assert.equal(firstItem[1].type, "text");
    assert.equal(firstItem[1].value, " point");
  });

  test("code inside a paragraph is tokenized correctly", () => {
    const blocks = tokenizeBlocks("Use the `fetch()` API to make requests.");
    const para = blocks[0] as Extract<Block, { type: "paragraph" }>;
    const tokens = para.lines[0];
    const codeToken = tokens.find((t) => t.type === "code");
    assert.ok(codeToken, "code token should exist");
    assert.equal(codeToken?.value, "fetch()");
  });

  test("full model answer with mixed content parses correctly", () => {
    const answer = [
      "The article discusses **climate change** and its effects.",
      "",
      "- Rising temperatures",
      "- Melting ice caps",
      "- Extreme weather",
      "",
      "Use `IPCC` reports for more detail.",
    ].join("\n");

    const blocks = tokenizeBlocks(answer);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, "paragraph");
    assert.equal(blocks[1].type, "ul");
    assert.equal(blocks[2].type, "paragraph");

    const ul = blocks[1] as Extract<Block, { type: "ul" }>;
    assert.equal(ul.items.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("very long text with no markdown stays as a single text token", () => {
    const long = "a".repeat(5000);
    const tokens = tokenizeInline(long);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "text");
    assert.equal(tokens[0].value.length, 5000);
  });

  test("multiple adjacent blocks with extra blank lines", () => {
    const blocks = tokenizeBlocks("A\n\n\n\nB");
    assert.equal(blocks.length, 2);
  });
});
