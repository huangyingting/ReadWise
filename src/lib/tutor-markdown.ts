/**
 * Tokenizer for AI tutor assistant answers — safe markdown-light parser.
 *
 * NO HTML output paths. All model text is represented as typed tokens so that
 * the React rendering layer (ArticleTutor.tsx) can map them to React elements
 * where every leaf terminates in a {string} child.
 *
 * XSS guarantee: there is no code path from model text → innerHTML.
 * Even if the model emits `<script>alert("xss")</script>`, the tokenizer
 * produces a plain `{ type:"text", value:"<script>alert(\"xss\")</script>" }`
 * token which React escapes as inert visible characters.
 *
 * Supported patterns (everything else is plain text):
 *   Paragraphs  — blocks separated by blank lines
 *   UL items    — lines starting with "- " or "• "
 *   OL items    — lines starting with "1. " / "2. " etc.
 *   Bold        — **text**
 *   Inline code — `text`
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "code"; value: string };

export type Block =
  | { type: "paragraph"; lines: InlineToken[][] }
  | { type: "ul"; items: InlineToken[][] }
  | { type: "ol"; items: InlineToken[][] };

// ---------------------------------------------------------------------------
// Inline tokenizer
// ---------------------------------------------------------------------------

const INLINE_RE = /\*\*([^*]*)\*\*|`([^`]*)`/g;

/**
 * Tokenize a single line of text into inline tokens.
 * The result never contains any HTML — only text/bold/code tokens.
 */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const [full, boldText, codeText] = match;
    const idx = match.index!;

    if (idx > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, idx) });
    }

    if (boldText !== undefined) {
      tokens.push({ type: "bold", value: boldText });
    } else if (codeText !== undefined) {
      tokens.push({ type: "code", value: codeText });
    }

    lastIndex = idx + full.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  // If nothing matched at all, return a single text token
  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}

// ---------------------------------------------------------------------------
// Block tokenizer
// ---------------------------------------------------------------------------

const UL_RE = /^[-•]\s+/;
const OL_RE = /^\d+\.\s+/;

/**
 * Parse a full answer string into typed blocks.
 * Blocks are separated by blank lines (two or more newlines).
 * Within a block, if every non-empty line starts with a list marker
 * the block is rendered as a list; otherwise as a paragraph.
 */
export function tokenizeBlocks(answer: string): Block[] {
  const rawBlocks = answer.split(/\n{2,}/);
  const blocks: Block[] = [];

  for (const raw of rawBlocks) {
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    const allUl = lines.every((l) => UL_RE.test(l));
    const allOl = lines.every((l) => OL_RE.test(l));

    if (allUl) {
      blocks.push({
        type: "ul",
        items: lines.map((l) => tokenizeInline(l.replace(UL_RE, ""))),
      });
    } else if (allOl) {
      blocks.push({
        type: "ol",
        items: lines.map((l) => tokenizeInline(l.replace(OL_RE, ""))),
      });
    } else {
      blocks.push({
        type: "paragraph",
        lines: lines.map((l) => tokenizeInline(l)),
      });
    }
  }

  return blocks;
}
