/**
 * Escapes characters that can break out of an inline `<script>` tag so
 * JSON-LD blocks are safe to inject via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` does NOT escape `<`, `>`, `&`, `\u2028`, or `\u2029`,
 * which allows a crafted string to terminate the script tag and inject
 * arbitrary HTML/JS. This follows the pattern used by Next.js internally and
 * recommended by Google's JSON-LD guidelines.
 */
const UNSAFE_JSON_CHARS = /[<>&\u2028\u2029]/g;

function escapeJsonChar(char: string): string {
  switch (char) {
    case "<":
      return "\\u003c";
    case ">":
      return "\\u003e";
    case "&":
      return "\\u0026";
    case "\u2028":
      return "\\u2028";
    case "\u2029":
      return "\\u2029";
    default:
      return char;
  }
}

export const __safeJsonTest = { escapeJsonChar };

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_JSON_CHARS, escapeJsonChar);
}
