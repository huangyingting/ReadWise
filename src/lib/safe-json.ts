/**
 * Escapes characters that can break out of an inline `<script>` tag so
 * JSON-LD blocks are safe to inject via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` does NOT escape `<`, `>`, `&`, `\u2028`, or `\u2029`,
 * which allows a crafted string to terminate the script tag and inject
 * arbitrary HTML/JS. This follows the pattern used by Next.js internally and
 * recommended by Google's JSON-LD guidelines.
 */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
