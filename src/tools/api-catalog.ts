/**
 * API catalog builder (REF-070, #716).
 *
 * Scans every `src/app/api/**\/route.ts` file, extracts exported HTTP methods
 * and handler metadata (auth mode, schemas, capability, runtime, response
 * format, request/response contract hints), and returns a structured
 * {@link ApiCatalog}.
 *
 * This module is imported by:
 *   - `scripts/generate-api-catalog.ts` — CLI that writes the catalog files.
 *   - `tests/api-catalog-drift.test.ts` — drift-detection test.
 *
 * The implementation is pure static-analysis (regex/string scanning); it never
 * loads or evaluates route modules, so it does not require a database, Next.js
 * context, or any environment variable.
 *
 * ## Contract metadata extraction — known limitations
 *
 * - `successStatus`: extracted from explicit 2xx `status` literals, simple
 *   local numeric constants, or local response-init constants; defaults to 200.
 * - `responseKeys`: extracted from the first successful
 *   `NextResponse.json({ ... })` / `Response.json({ ... })` call in the
 *   handler or a simple local response helper; `null` when the argument is an
 *   opaque variable/expression.
 * - `queryParamNames`: extracted from `queryString/queryInt/queryBool/queryFloat`
 *   helper calls and `params.get("name")` usages in handlers, inline query
 *   functions, and simple local query helpers; `null` when the route delegates
 *   query parsing to an external function with no discoverable calls.
 * - `bodyFieldNames`: extracted from inline `object({...})` body schemas or
 *   from a `const varName = object({...})` variable referenced in the config;
 *   `null` for custom schema functions, Zod schemas, or opaque references.
 *
 * ## How the CI drift check should run (#717)
 *
 * ```sh
 * npm run api-catalog          # regenerate in-place
 * git diff --exit-code docs/platform/api-catalog.json  # fail if stale
 * ```
 * Or simply run the focused drift test which does the in-memory comparison:
 * ```sh
 * npm test -- --test-name-pattern "api-catalog"
 * ```
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthMode } from "@/lib/api-handler";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repo root (two levels up from src/lib). */
const ROOT = resolve(__dirname, "../..");
const API_ROOT = join(ROOT, "src", "app", "api");

// ── Public types ──────────────────────────────────────────────────────────

export type { AuthMode } from "@/lib/api-handler";
export type ResponseFormat =
  | "json"
  | "binary"
  | "text/plain"
  | "text/csv"
  | "download-json"
  | "mixed"
  | "nextauth";

export interface MethodEntry {
  method: string;
  authMode: AuthMode;
  capability: string | null;
  hasBodySchema: boolean;
  hasParamsSchema: boolean;
  hasQuerySchema: boolean;
  responseFormat: ResponseFormat;
  notes: string[];
  /** HTTP success status code (200 default; 201/204 when statically detected). */
  successStatus: number;
  /**
   * Top-level keys of the first `NextResponse.json({ ... })` call in the
   * handler, sorted for determinism.  `null` when the argument is not a
   * statically-readable object literal.
   */
  responseKeys: string[] | null;
  /**
   * Query-string parameter names inferred from `queryString/queryInt/queryBool/
   * queryFloat` helper calls and `params.get("name")` usages, sorted.
   * `null` when none were detected (e.g. query parsing is fully delegated).
   */
  queryParamNames: string[] | null;
  /**
   * Body-schema field names inferred from inline `object({...})` schemas or a
   * `const varName = object({...})` variable referenced in the config, sorted.
   * `null` when the schema is a custom function / opaque reference.
   */
  bodyFieldNames: string[] | null;
}

export interface RouteEntry {
  path: string;
  file: string;
  runtime: "default" | "nodejs" | "edge";
  methods: MethodEntry[];
}

export interface ApiCatalog {
  generatedAt: string;
  routeCount: number;
  methodCount: number;
  routes: RouteEntry[];
}

// ── File walker ───────────────────────────────────────────────────────────

function walkDir(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkDir(full, results);
    } else if (entry === "route.ts") {
      results.push(full);
    }
  }
  return results;
}

// ── Path derivation ───────────────────────────────────────────────────────

function fileToApiPath(filePath: string): string {
  // src/app/api/reader/[id]/speech/audio/route.ts → /api/reader/{id}/speech/audio
  const rel = relative(join(ROOT, "src", "app"), filePath);
  return (
    "/" +
    rel
      .replace(/\/route\.ts$/, "")
      .replace(/\[\.\.\.([^\]]+)\]/g, "{...$1}")
      .replace(/\[([^\]]+)\]/g, "{$1}")
  );
}

// ── Static-analysis helpers ───────────────────────────────────────────────

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;
const HANDLER_WINDOW_CHARS = 5000;
const IDENTIFIER_SOURCE = "[a-zA-Z_$][\\w$]*";
const IDENTIFIER_RE = /^[a-zA-Z_$][\w$]*$/;
const JSON_RESPONSE_CALL_RE = /\b(?:NextResponse|Response)\.json\s*\(/g;
const DEFAULT_AUTH_COUNTS: Record<AuthMode, number> = {
  public: 0,
  session: 0,
  admin: 0,
  capability: 0,
};

// ── Contract-extraction helpers ───────────────────────────────────────────

/**
 * Return the content between the first balanced `{...}` pair starting at
 * `openPos` in `source` (openPos must point at the `{` character).
 */
function sliceBracketContent(source: string, openPos: number): string {
  return sliceBalancedContent(source, openPos, "{", "}");
}

function sliceParenContent(source: string, openPos: number): string {
  return sliceBalancedContent(source, openPos, "(", ")");
}

function findBalancedClose(
  source: string,
  openPos: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  for (let i = openPos; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === q) { break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === "`") { break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sliceBalancedContent(
  source: string,
  openPos: number,
  openChar: string,
  closeChar: string,
): string {
  let depth = 0;
  let start = -1;
  for (let i = openPos; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === q) { break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === "`") { break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (ch === openChar) {
      depth++;
      if (depth === 1) start = i + 1;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return "";
}

/**
 * Extract top-level property key names from a JS object literal body string
 * (the content *between* the outer `{}`), sorted for determinism.
 *
 * Handles: named properties (`key: value`), shorthand properties (`key`), and
 * spread operators (`...rest`) — spread identifiers are silently skipped.
 * Skips string literals, comments, and nested bracket contents so value
 * expressions do not contribute false key names.
 */
function extractObjectKeyNames(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  /** True after `key:` until the next top-level comma (value expression mode). */
  let inValue = false;
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    // ── Skip quoted strings ───────────────────────────────────────────────
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < body.length) {
        if (body[i] === "\\") { i += 2; continue; }
        if (body[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < body.length) {
        if (body[i] === "\\") { i += 2; continue; }
        if (body[i] === "`") { i++; break; }
        i++;
      }
      continue;
    }
    // Skip line comments.
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    // Skip block comments (includes JSDoc inside schema objects).
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length - 1 && !(body[i] === "*" && body[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Track bracket depth BEFORE top-level logic so that value expressions
    // with `{`, `[`, `(` are depth-counted even while inValue is true.
    if (ch === "{" || ch === "[" || ch === "(") { depth++; i++; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; i++; continue; }

    if (depth === 0) {
      // Comma at the top level ends the current property (key or value).
      if (ch === ",") { inValue = false; i++; continue; }

      // While parsing a value expression, skip top-level chars (nested
      // structures are already handled by the depth counter above).
      if (inValue) { i++; continue; }

      // Skip spread operators (`...identifier`).
      if (ch === "." && body[i + 1] === "." && body[i + 2] === ".") {
        i += 3;
        const m = /^[a-zA-Z_$][\w$]*/.exec(body.slice(i));
        if (m) i += m[0].length;
        continue;
      }

      // Match an identifier at the top level and classify as key or value.
      if (/[a-zA-Z_$]/.test(ch)) {
        const m = /^[a-zA-Z_$][\w$]*/.exec(body.slice(i));
        if (m) {
          const id = m[0];
          const afterTrimmed = body.slice(i + id.length).trimStart();
          if (afterTrimmed.startsWith(":")) {
            // Named property (`key: value`) — record key, enter value mode.
            keys.push(id);
            inValue = true;
          } else if (
            afterTrimmed.startsWith(",") ||
            afterTrimmed.startsWith("}") ||
            afterTrimmed === "" ||
            afterTrimmed.startsWith("\n")
          ) {
            // Shorthand property (`key` alone) — record key, stay in key mode.
            keys.push(id);
          }
          // Otherwise part of a value expression — skip without recording.
          i += id.length;
          continue;
        }
      }
    }

    i++;
  }

  return sortedUnique(keys);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function splitTopLevelArguments(argsSource: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < argsSource.length; i++) {
    const ch = argsSource[i];

    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < argsSource.length) {
        if (argsSource[i] === "\\") { i++; }
        else if (argsSource[i] === q) { break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < argsSource.length) {
        if (argsSource[i] === "\\") { i++; }
        else if (argsSource[i] === "`") { break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && argsSource[i + 1] === "/") {
      while (i < argsSource.length && argsSource[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && argsSource[i + 1] === "*") {
      i += 2;
      while (i < argsSource.length - 1 && !(argsSource[i] === "*" && argsSource[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") { depth++; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; continue; }
    if (ch === "," && depth === 0) {
      args.push(argsSource.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = argsSource.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function callArgumentsAt(source: string, openParenPos: number): string[] {
  const content = sliceParenContent(source, openParenPos);
  return content ? splitTopLevelArguments(content) : [];
}

function stripConstAssertions(expression: string): string {
  return expression
    .trim()
    .replace(/\s+as\s+const\s*$/s, "")
    .replace(/\s+satisfies\s+[^,)}]+$/s, "")
    .trim();
}

function findConstObjectBody(source: string, name: string): string | null {
  const constRe = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`);
  const match = constRe.exec(source);
  if (!match) return null;
  const bracePos = source.indexOf("{", match.index + match[0].length - 1);
  if (bracePos === -1) return null;
  return sliceBracketContent(source, bracePos) || null;
}

function resolveNumberExpression(expression: string, fullSource: string): number | null {
  const normalized = stripConstAssertions(expression);
  if (/^\d{3}$/.test(normalized)) return parseInt(normalized, 10);
  if (!IDENTIFIER_RE.test(normalized)) return null;

  const constRe = new RegExp(`\\bconst\\s+${normalized}\\s*(?::[^=]+)?=\\s*(\\d{3})\\b`);
  const match = constRe.exec(fullSource);
  return match ? parseInt(match[1], 10) : null;
}

function readTopLevelPropertyValue(body: string, propertyName: string): string | null {
  let depth = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < body.length) {
        if (body[i] === "\\") { i++; }
        else if (body[i] === q) { break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < body.length) {
        if (body[i] === "\\") { i++; }
        else if (body[i] === "`") { break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length - 1 && !(body[i] === "*" && body[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") { depth++; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; continue; }

    if (depth === 0 && /[a-zA-Z_$]/.test(ch)) {
      const idMatch = /^[a-zA-Z_$][\w$]*/.exec(body.slice(i));
      if (!idMatch) continue;
      const id = idMatch[0];
      const afterId = body.slice(i + id.length);
      const colonOffset = afterId.search(/\S/);
      if (id === propertyName && colonOffset !== -1 && afterId[colonOffset] === ":") {
        const valueStart = i + id.length + colonOffset + 1;
        return readTopLevelValue(body, valueStart);
      }
      i += id.length - 1;
    }
  }

  return null;
}

function readTopLevelValue(source: string, start: number): string {
  let depth = 0;
  let valueStart = start;
  while (/\s/.test(source[valueStart] ?? "")) valueStart++;

  for (let i = valueStart; i < source.length; i++) {
    const ch = source[i];

    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === q) { break; }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i++; }
        else if (source[i] === "`") { break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") { depth++; continue; }
    if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) return source.slice(valueStart, i).trim();
      depth--;
      continue;
    }
    if (ch === "," && depth === 0) return source.slice(valueStart, i).trim();
  }

  return source.slice(valueStart).trim();
}

function extractStatusFromObjectBody(
  body: string,
  fullSource: string,
  visited = new Set<string>(),
): number | null {
  const directStatus = readTopLevelPropertyValue(body, "status");
  if (directStatus) {
    const status = resolveNumberExpression(directStatus, fullSource);
    if (status !== null) return status;
  }

  const spreadRe = /\.\.\.\s*([a-zA-Z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = spreadRe.exec(body)) !== null) {
    const name = match[1];
    if (visited.has(name)) continue;
    visited.add(name);
    const spreadBody = findConstObjectBody(fullSource, name);
    if (!spreadBody) continue;
    const status = extractStatusFromObjectBody(spreadBody, fullSource, visited);
    if (status !== null) return status;
  }

  return null;
}

function extractStatusFromInitArg(initArg: string | undefined, fullSource: string): number | null {
  if (!initArg) return null;
  const arg = stripConstAssertions(initArg);
  if (arg.startsWith("{")) {
    const bracePos = initArg.indexOf("{");
    const body = sliceBracketContent(initArg, bracePos);
    return extractStatusFromObjectBody(body, fullSource);
  }
  if (IDENTIFIER_RE.test(arg)) {
    const body = findConstObjectBody(fullSource, arg);
    return body ? extractStatusFromObjectBody(body, fullSource) : null;
  }
  return null;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    while (/\s/.test(source[i] ?? "")) i++;
    if (source[i] === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function findImplementationBraceAfterSignature(source: string, start: number): number {
  let i = skipWhitespaceAndComments(source, start);
  if (source[i] === "{") return i;
  if (source[i] !== ":") return -1;

  i++;
  let expectTypeToken = true;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    const ch = source[i];
    if (!ch) return -1;

    if (ch === "{") {
      if (!expectTypeToken) return i;
      const closePos = findBalancedClose(source, i, "{", "}");
      if (closePos === -1) return -1;
      i = closePos + 1;
      expectTypeToken = false;
      continue;
    }
    if (ch === "<" || ch === "(" || ch === "[") {
      const closePos = findBalancedClose(
        source,
        i,
        ch,
        ch === "<" ? ">" : ch === "(" ? ")" : "]",
      );
      if (closePos === -1) return -1;
      i = closePos + 1;
      expectTypeToken = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === q) { i++; break; }
        i++;
      }
      expectTypeToken = false;
      continue;
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      const idMatch = /^[a-zA-Z_$][\w$]*/.exec(source.slice(i));
      if (!idMatch) return -1;
      i += idMatch[0].length;
      expectTypeToken = false;
      continue;
    }
    if (ch === ".") {
      i++;
      expectTypeToken = true;
      continue;
    }
    if (ch === "|" || ch === "&" || ch === "," || ch === ":") {
      i++;
      expectTypeToken = true;
      continue;
    }
    if (ch === "?" || ch === "!" || ch === "*") {
      i++;
      continue;
    }
    i++;
  }

  return -1;
}

function findFunctionBody(source: string, name: string): string | null {
  const functionRe = new RegExp(`(?:async\\s+)?function\\s+${name}\\b`);
  const functionMatch = functionRe.exec(source);
  if (functionMatch) {
    let cursor = skipWhitespaceAndComments(
      source,
      functionMatch.index + functionMatch[0].length,
    );
    if (source[cursor] === "<") {
      const typeParamsEnd = findBalancedClose(source, cursor, "<", ">");
      if (typeParamsEnd === -1) return null;
      cursor = skipWhitespaceAndComments(source, typeParamsEnd + 1);
    }
    if (source[cursor] !== "(") return null;
    const paramsEnd = findBalancedClose(source, cursor, "(", ")");
    if (paramsEnd === -1) return null;
    const bracePos = findImplementationBraceAfterSignature(source, paramsEnd + 1);
    return bracePos === -1 ? null : sliceBracketContent(source, bracePos);
  }

  const arrowBlockRe = new RegExp(
    `\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${IDENTIFIER_SOURCE})\\s*(?::[^=]+)?=>\\s*\\{`,
  );
  const arrowBlockMatch = arrowBlockRe.exec(source);
  if (arrowBlockMatch) {
    const bracePos = source.indexOf("{", arrowBlockMatch.index + arrowBlockMatch[0].length - 1);
    return bracePos === -1 ? null : sliceBracketContent(source, bracePos);
  }

  const arrowExpressionRe = new RegExp(
    `\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${IDENTIFIER_SOURCE})\\s*(?::[^=]+)?=>\\s*([^;]+);`,
  );
  const arrowExpressionMatch = arrowExpressionRe.exec(source);
  return arrowExpressionMatch ? `return ${arrowExpressionMatch[1]};` : null;
}

function collectCalledHelperNames(source: string): Set<string> {
  const names = new Set<string>();
  const returnCallRe = new RegExp(`\\breturn\\s+(${IDENTIFIER_SOURCE})\\s*\\(`, "g");
  addNamedMatches(names, returnCallRe, source);

  const jsonPayloadCallRe = new RegExp(
    `\\b(?:NextResponse|Response)\\.json\\s*\\(\\s*(${IDENTIFIER_SOURCE})\\s*\\(`,
    "g",
  );
  addNamedMatches(names, jsonPayloadCallRe, source);

  return names;
}

function addNamedMatches(target: Set<string>, regex: RegExp, source: string): void {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) target.add(match[1]);
}

function collectResponseWindows(handlerWindow: string, fullSource: string): string[] {
  const windows = [handlerWindow];
  const queue = [handlerWindow];
  const visited = new Set<string>();

  while (queue.length > 0 && windows.length < 20) {
    const current = queue.shift() ?? "";
    for (const name of collectCalledHelperNames(current)) {
      if (visited.has(name)) continue;
      visited.add(name);
      const body = findFunctionBody(fullSource, name);
      if (!body) continue;
      windows.push(body);
      queue.push(body);
    }
  }

  return windows;
}

function extractReferencedConstObjectBodies(windows: string[], fullSource: string): string[] {
  const bodies: string[] = [];
  const seen = new Set<string>();
  const queue = windows.join("\n");
  const identifierRe = new RegExp(`\\b(${IDENTIFIER_SOURCE})\\b`, "g");

  let match: RegExpExecArray | null;
  while ((match = identifierRe.exec(queue)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const body = findConstObjectBody(fullSource, name);
    if (body) bodies.push(body);
  }

  return bodies;
}

function extractJsonResponseCalls(source: string): string[][] {
  const calls: string[][] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(JSON_RESPONSE_CALL_RE);
  while ((match = re.exec(source)) !== null) {
    const openParenPos = source.indexOf("(", match.index);
    if (openParenPos === -1) continue;
    const args = callArgumentsAt(source, openParenPos);
    if (args.length > 0) calls.push(args);
  }
  return calls;
}

/**
 * Detect the HTTP success status code from a handler source window.
 * Returns 204 when a `new (Next)Response(null, { status: 204 })` pattern is
 * found, 201 when `NextResponse.json({...}, { status: 201 })`, otherwise 200.
 */
function extractSuccessStatus(handlerWindow: string, fullSource: string): number {
  for (const windowSource of collectResponseWindows(handlerWindow, fullSource)) {
    for (const args of extractJsonResponseCalls(windowSource)) {
      const status = extractStatusFromInitArg(args[1], fullSource) ?? 200;
      if (status >= 200 && status < 300) return status;
    }

    const responseRe = /\bnew\s+(?:Next)?Response\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = responseRe.exec(windowSource)) !== null) {
      const openParenPos = windowSource.indexOf("(", match.index);
      if (openParenPos === -1) continue;
      const args = callArgumentsAt(windowSource, openParenPos);
      const status = extractStatusFromInitArg(args[1], fullSource) ?? 200;
      if (status >= 200 && status < 300) return status;
    }
  }

  return 200;
}

/**
 * Extract top-level response keys from the first `NextResponse.json({ ... })`
 * call in `handlerWindow`.  Returns `null` when the argument is not a literal
 * object (e.g. `NextResponse.json(result)`).
 */
function extractResponseKeys(handlerWindow: string, fullSource: string): string[] | null {
  for (const windowSource of collectResponseWindows(handlerWindow, fullSource)) {
    for (const args of extractJsonResponseCalls(windowSource)) {
      const status = extractStatusFromInitArg(args[1], fullSource) ?? 200;
      if (status < 200 || status >= 300) continue;

      const keys = extractJsonPayloadKeys(args[0], fullSource);
      if (keys) return keys;
    }
  }

  return null;
}

function extractJsonPayloadKeys(payloadArg: string | undefined, fullSource: string): string[] | null {
  if (!payloadArg) return null;
  const payload = stripConstAssertions(payloadArg);

  if (payload.startsWith("{")) {
    const bracePos = payloadArg.indexOf("{");
    const body = sliceBracketContent(payloadArg, bracePos);
    if (!body.trim()) return null;
    const keys = extractObjectKeyNames(body);
    return keys.length > 0 ? keys : null;
  }

  if (IDENTIFIER_RE.test(payload)) {
    const body = findConstObjectBody(fullSource, payload);
    if (!body) return null;
    const keys = extractObjectKeyNames(body);
    return keys.length > 0 ? keys : null;
  }

  const helperCall = new RegExp(`^(${IDENTIFIER_SOURCE})\\s*\\(`).exec(payload);
  if (helperCall) return extractReturnObjectKeys(helperCall[1], fullSource);

  return null;
}

function extractReturnObjectKeys(functionName: string, fullSource: string): string[] | null {
  const body = findFunctionBody(fullSource, functionName);
  if (!body) return null;

  const returnObjectRe = /\breturn\s+(?:\(\s*)?\{/g;
  const match = returnObjectRe.exec(body);
  if (!match) return null;
  const bracePos = body.indexOf("{", match.index);
  if (bracePos === -1) return null;

  const keys = extractObjectKeyNames(sliceBracketContent(body, bracePos));
  return keys.length > 0 ? keys : null;
}

/**
 * Extract query-string parameter names from the method's source window.
 * Detects `queryString/queryInt/queryBool/queryFloat(params, "name")` and
 * `params.get("name")` patterns.
 */
function extractQueryParamNames(
  configWindow: string,
  handlerWindow: string,
  fullSource: string,
): string[] | null {
  const names = new Set<string>();

  const helperRe = /\bquery(?:String|Int|Bool|Float)\s*\(\s*\w+\s*,\s*["'](\w+)["']/g;
  addRegexCaptures(names, helperRe, handlerWindow);

  const getterRe = /\bparams\.get\(\s*["'](\w+)["']/g;
  addRegexCaptures(names, getterRe, handlerWindow);

  addTimezoneQueryHelperNames(names, configWindow);
  addTimezoneQueryHelperNames(names, handlerWindow);

  for (const queryWindow of collectQueryConfigWindows(configWindow, fullSource)) {
    addRegexCaptures(names, helperRe, queryWindow);
    addRegexCaptures(names, getterRe, queryWindow);
    addTimezoneQueryHelperNames(names, queryWindow);
    addQueryParamsFromForwardedHelperCalls(names, queryWindow, fullSource);
  }

  return names.size > 0 ? sortedUnique(names) : null;
}

function addTimezoneQueryHelperNames(names: Set<string>, source: string): void {
  if (/\bquery\s*:\s*parseOptionalTimezoneQuery\b/.test(source)) {
    names.add("timezone");
  }
  const timezoneHelperRe = /\bparseOptionalTimezoneQuery\s*\(\s*\w+(?:\s*,\s*["'](\w+)["'])?/g;
  let match: RegExpExecArray | null;
  while ((match = timezoneHelperRe.exec(source)) !== null) {
    names.add(match[1] ?? "timezone");
  }
}

function collectQueryConfigWindows(configWindow: string, fullSource: string): string[] {
  const queryValue = readConfigPropertyValue(configWindow, "query");
  const normalizedQueryValue = queryValue ? stripConstAssertions(queryValue) : null;

  if (normalizedQueryValue && IDENTIFIER_RE.test(normalizedQueryValue)) {
    const queryBody = findFunctionBody(fullSource, normalizedQueryValue);
    return queryBody ? collectLocalFunctionWindows(queryBody, fullSource) : [];
  }

  if (queryValue) return collectLocalFunctionWindows(queryValue, fullSource);

  const queryRefMatch = /\bquery\s*:\s*([a-zA-Z_$][\w$]*)/.exec(configWindow);
  if (!queryRefMatch) return [];

  const queryBody = findFunctionBody(fullSource, queryRefMatch[1]);
  return queryBody ? collectLocalFunctionWindows(queryBody, fullSource) : [];
}

function readConfigPropertyValue(configWindow: string, propertyName: string): string | null {
  const normalized = stripConstAssertions(configWindow);
  if (normalized.startsWith("{")) {
    const bracePos = configWindow.indexOf("{");
    if (bracePos !== -1) {
      return readTopLevelPropertyValue(sliceBracketContent(configWindow, bracePos), propertyName);
    }
  }

  return readTopLevelPropertyValue(configWindow, propertyName);
}

function collectLocalFunctionWindows(rootBody: string, fullSource: string): string[] {
  const windows = [rootBody];
  const queue = [rootBody];
  const visited = new Set<string>();
  const localCallRe = new RegExp(`\\b(${IDENTIFIER_SOURCE})\\s*\\(`, "g");

  while (queue.length > 0 && windows.length < 20) {
    const current = queue.shift() ?? "";
    let match: RegExpExecArray | null;
    localCallRe.lastIndex = 0;
    while ((match = localCallRe.exec(current)) !== null) {
      const name = match[1];
      if (visited.has(name)) continue;
      visited.add(name);
      const body = findFunctionBody(fullSource, name);
      if (!body) continue;
      windows.push(body);
      queue.push(body);
    }
  }

  return windows;
}

function addQueryParamsFromForwardedHelperCalls(
  names: Set<string>,
  queryBody: string,
  fullSource: string,
): void {
  const localCallRe = new RegExp(
    `\\b(${IDENTIFIER_SOURCE})\\s*\\(\\s*\\w+\\s*,\\s*["'](\\w+)["']`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = localCallRe.exec(queryBody)) !== null) {
    const helperBody = findFunctionBody(fullSource, match[1]);
    if (!helperBody) continue;
    if (/\bquery(?:String|Int|Bool|Float)\s*\(/.test(helperBody) || /\bparams\.get\(/.test(helperBody)) {
      names.add(match[2]);
    }
  }
}

function addRegexCaptures(target: Set<string>, regex: RegExp, source: string): void {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const value = match[1];
    if (value !== undefined) target.add(value);
  }
}

/**
 * Extract body-schema field names from the handler config window or full source.
 *
 * Strategy:
 * 1. If `body: object({...})` appears inline in `configWindow`, parse the keys.
 * 2. If `body: varName` references a variable, find `const varName = object({...})`
 *    in the full `source` and parse its keys.
 * 3. Otherwise return `null`.
 */
function extractBodyFieldNames(
  configWindow: string,
  fullSource: string,
): string[] | null {
  if (!/\bbody\s*:/.test(configWindow)) return null;

  const inlineFields = extractInlineBodyFields(configWindow);
  if (inlineFields) return inlineFields;

  return extractReferencedBodyFields(configWindow, fullSource);
}

function extractInlineBodyFields(configWindow: string): string[] | null {
  const inlineMatch = /\bbody\s*:\s*object\s*\(/.exec(configWindow);
  if (!inlineMatch) return null;

  const bracePos = configWindow.indexOf("{", inlineMatch.index + inlineMatch[0].length);
  if (bracePos === -1) return null;

  const keys = extractObjectKeyNames(sliceBracketContent(configWindow, bracePos));
  return keys.length > 0 ? keys : null;
}

function extractReferencedBodyFields(configWindow: string, fullSource: string): string[] | null {
  const varRefMatch = /\bbody\s*:\s*([a-zA-Z_$][\w$]*)/.exec(configWindow);
  if (varRefMatch) {
    const varName = varRefMatch[1];
    // Skip primitives or built-ins.
    if (/^(?:true|false|null|undefined|\d)/.test(varName)) return null;

    // Match: const varName = object({...}) or const varName: Schema<...> = object({...})
    const varDefRe = new RegExp(
      `const\\s+${varName}\\s*(?::[^=]+)?=\\s*object\\s*\\(`,
    );
    const varMatch = varDefRe.exec(fullSource);
    if (varMatch) {
      const bracePos = fullSource.indexOf("{", varMatch.index + varMatch[0].length);
      if (bracePos !== -1) {
        const body = sliceBracketContent(fullSource, bracePos);
        const keys = extractObjectKeyNames(body);
        if (keys.length > 0) return keys;
      }
    }
  }

  return null;
}

function authModeForWrapper(wrapperName: string): AuthMode {
  if (wrapperName === "createAdminHandler") return "admin";
  if (wrapperName === "createPublicHandler") return "public";
  if (wrapperName === "createCapabilityHandler") return "capability";
  return "session";
}

function extractHandlerWindow(source: string, matchIndex: number): string {
  const nextMethodRe =
    /\nexport\s+const\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*=/g;
  nextMethodRe.lastIndex = matchIndex + 1;
  const nextMatch = nextMethodRe.exec(source);
  return source.slice(
    matchIndex,
    nextMatch ? nextMatch.index : Math.min(matchIndex + HANDLER_WINDOW_CHARS, source.length),
  );
}

function extractMethodEntry(method: string, source: string): MethodEntry | null {
  // Match: export const METHOD = createXxxHandler(...)
  const wrapperRe = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*(create(?:Admin|Public|Capability)?Handler)\\s*\\(`,
    "g",
  );
  const match = wrapperRe.exec(source);
  if (!match) return null;

  const wrapperName = match[1];
  const authMode = authModeForWrapper(wrapperName);

  let capability: string | null = null;
  if (authMode === "capability") {
    const capRe = new RegExp(
      `export\\s+const\\s+${method}\\s*=\\s*createCapabilityHandler\\s*\\(\\s*(?:CAPABILITIES\\.([\\w.]+)|['"](\\w+)['"])`,
    );
    const capMatch = capRe.exec(source);
    if (capMatch) {
      capability = capMatch[1] ?? capMatch[2] ?? null;
    }
  }

  const openParenPos = source.indexOf("(", match.index + match[0].length - 1);
  const handlerArgs = openParenPos === -1 ? [] : callArgumentsAt(source, openParenPos);
  const methodConfigSource =
    (wrapperName === "createCapabilityHandler" ? handlerArgs[1] : handlerArgs[0]) ??
    "";
  const hasBodySchema = readConfigPropertyValue(methodConfigSource, "body") !== null;
  const hasParamsSchema = readConfigPropertyValue(methodConfigSource, "params") !== null;
  const hasQuerySchema = readConfigPropertyValue(methodConfigSource, "query") !== null;

  // Handler window: from the export to the next method export (or +5000 chars).
  // Used for success-status and response-key extraction.
  const handlerWindow = extractHandlerWindow(source, match.index);

  const responseFormat = detectResponseFormat(handlerWindow, source);

  const successStatus = extractSuccessStatus(handlerWindow, source);
  const responseKeys = extractResponseKeys(handlerWindow, source);
  const queryParamNames = hasQuerySchema
    ? extractQueryParamNames(methodConfigSource, handlerWindow, source)
    : null;
  const bodyFieldNames = hasBodySchema ? extractBodyFieldNames(methodConfigSource, source) : null;

  const notes: string[] = [];
  if (authMode === "capability" && capability) {
    notes.push(`capability: CAPABILITIES.${capability}`);
  }

  return {
    method,
    authMode,
    capability,
    hasBodySchema,
    hasParamsSchema,
    hasQuerySchema,
    responseFormat,
    notes,
    successStatus,
    responseKeys,
    queryParamNames,
    bodyFieldNames,
  };
}

function detectResponseFormat(handlerWindow: string, fullSource: string): ResponseFormat {
  const responseWindows = sortedUnique(
    collectResponseWindows(handlerWindow, fullSource).flatMap((windowSource) =>
      collectLocalFunctionWindows(windowSource, fullSource),
    ),
  );
  const responseSource = [
    ...responseWindows,
    ...extractReferencedConstObjectBodies(responseWindows, fullSource),
  ].join("\n");
  const lower = responseSource.toLowerCase();
  const hasJsonResponseCall = responseWindows.some((windowSource) =>
    /\b(?:NextResponse|Response)\.json\s*\(/.test(windowSource),
  );
  const hasAttachment = /content-disposition[^,\n}]*attachment/i.test(responseSource);
  const hasJson = /application\/json/i.test(responseSource) || /\.json\b/i.test(responseSource);
  const hasCsv = /text\/csv/i.test(responseSource) || /\.csv\b/i.test(responseSource);
  const hasPlain = /text\/plain/i.test(responseSource);

  if (/"audio\//.test(responseSource) || /mimeType/.test(responseSource)) return "binary";
  if (hasAttachment && hasJson && hasCsv) return "mixed";
  if (hasAttachment && hasJson) return "download-json";
  if (hasAttachment && hasCsv) return "text/csv";
  if (hasCsv) return "text/csv";
  if (hasPlain) return "text/plain";
  if (hasJsonResponseCall || lower.includes("application/json")) return "json";
  if (hasAttachment) return "mixed";
  return "json";
}

// ── Route parser ──────────────────────────────────────────────────────────

function nextAuthMethodEntry(method: string): MethodEntry {
  return {
    method,
    authMode: "public",
    capability: null,
    hasBodySchema: false,
    hasParamsSchema: false,
    hasQuerySchema: false,
    responseFormat: "nextauth",
    notes: ["NextAuth.js handler — manages OAuth/credentials sessions"],
    successStatus: 200,
    responseKeys: null,
    queryParamNames: null,
    bodyFieldNames: null,
  };
}

function extractRuntime(source: string): RouteEntry["runtime"] {
  const runtimeMatch = /export\s+const\s+runtime\s*=\s*["']([\w-]+)["']/.exec(source);
  return runtimeMatch?.[1] === "nodejs"
    ? "nodejs"
    : runtimeMatch?.[1] === "edge"
      ? "edge"
      : "default";
}

function extractRouteMethods(source: string): MethodEntry[] {
  const methods: MethodEntry[] = [];
  for (const method of HTTP_METHODS) {
    const entry = extractMethodEntry(method, source);
    if (entry) methods.push(entry);
  }
  return methods;
}

function parseRouteFile(filePath: string): RouteEntry | null {
  const source = readFileSync(filePath, "utf8");
  const apiPath = fileToApiPath(filePath);
  const fileRel = relative(ROOT, filePath);

  // Special case: NextAuth catch-all route.
  if (/from\s+["']next-auth["']/.test(source) && /NextAuth/.test(source)) {
    return {
      path: apiPath,
      file: fileRel,
      runtime: "default",
      methods: [nextAuthMethodEntry("GET"), nextAuthMethodEntry("POST")],
    };
  }

  const runtime = extractRuntime(source);
  const methods = extractRouteMethods(source);

  if (methods.length === 0) return null;

  return { path: apiPath, file: fileRel, runtime, methods };
}

// ── Public catalog builder ────────────────────────────────────────────────

export function buildCatalog(): ApiCatalog {
  const files = walkDir(API_ROOT).sort();
  const routes: RouteEntry[] = [];

  for (const file of files) {
    const entry = parseRouteFile(file);
    if (entry) routes.push(entry);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));

  const methodCount = routes.reduce((n, r) => n + r.methods.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    methodCount,
    routes,
  };
}

// ── Markdown renderer ─────────────────────────────────────────────────────

const AUTH_BADGE: Record<AuthMode, string> = {
  public: "🔓 public",
  session: "🔐 session",
  admin: "🛡️ admin",
  capability: "⚡ capability",
};

const FORMAT_BADGE: Record<ResponseFormat, string> = {
  json: "JSON",
  binary: "binary",
  "text/plain": "text/plain",
  "text/csv": "text/csv",
  "download-json": "JSON download",
  mixed: "mixed",
  nextauth: "NextAuth",
};

function schemaBadges(method: MethodEntry): string {
  return [
    method.hasBodySchema ? "`B`" : "",
    method.hasParamsSchema ? "`P`" : "",
    method.hasQuerySchema ? "`Q`" : "",
  ]
    .filter(Boolean)
    .join(" ") || "—";
}

function countAuthModes(routes: RouteEntry[]): Record<AuthMode, number> {
  const counts = { ...DEFAULT_AUTH_COUNTS };
  for (const route of routes) {
    for (const method of route.methods) counts[method.authMode]++;
  }
  return counts;
}

function nonJsonMethods(routes: RouteEntry[]): Array<{
  path: string;
  method: string;
  format: ResponseFormat;
}> {
  return routes.flatMap((route) =>
    route.methods
      .filter((method) => method.responseFormat !== "json")
      .map((method) => ({ path: route.path, method: method.method, format: method.responseFormat })),
  );
}

function nullableList(values: string[] | null): string {
  return values ? values.join(", ") : "—";
}

export function buildCatalogMarkdown(catalog: ApiCatalog): string {
  const lastUpdated = catalog.generatedAt.slice(0, 10);
  const lines: string[] = [
    "---",
    "type: \"catalog\"",
    "status: \"generated\"",
    `last_updated: \"${lastUpdated}\"`,
    "description: \"Generated inventory of Next.js API route boundaries, auth modes, schemas, and response formats. Generated from src/app/api route handlers by src/tools/api-catalog.ts; do not edit by hand.\"",
    "---",
    "",
    "# ReadWise API Catalog",
    "",
    `> Auto-generated by \`npm run api-catalog\` — do not edit by hand.`,
    `> Last generated: ${catalog.generatedAt}`,
    "",
    `**${catalog.routeCount} routes · ${catalog.methodCount} method handlers**`,
    "",
    "## Catalog generation model",
    "",
    "```mermaid",
    "flowchart LR",
    '    routes["Next.js API route handlers"] --> analyzer["Static catalog analyzer"]',
    '    analyzer --> identity["Path, method, and runtime"]',
    '    analyzer --> access["Auth mode and capability"]',
    '    analyzer --> schemas["Body, path, and query schemas"]',
    '    analyzer --> responses["Status and response contract"]',
    '    identity --> catalog["Generated Markdown and JSON catalog"]',
    "    access --> catalog",
    "    schemas --> catalog",
    "    responses --> catalog",
    "```",
    "",
    "## Legend",
    "",
    "| Symbol | Meaning |",
    "|--------|---------|",
    "| 🔓 public | No authentication required |",
    "| 🔐 session | Authenticated user session required |",
    "| 🛡️ admin | Admin role required |",
    "| ⚡ capability | Named RBAC capability required |",
    "| `B` | Body schema validated |",
    "| `P` | Path params schema validated |",
    "| `Q` | Query schema validated |",
    "",
    "## Routes",
    "",
    "| Path | Method | Auth | Schemas | Status | Response | Runtime | Notes |",
    "|------|--------|------|---------|--------|----------|---------|-------|",
  ];

  for (const route of catalog.routes) {
    for (const m of route.methods) {
      const runtime = route.runtime !== "default" ? route.runtime : "";
      const notes = m.notes.join("; ");
      lines.push(
        `| \`${route.path}\` | ${m.method} | ${AUTH_BADGE[m.authMode]} | ${schemaBadges(m)} | ${m.successStatus} | ${FORMAT_BADGE[m.responseFormat]} | ${runtime} | ${notes} |`,
      );
    }
  }

  lines.push("", "## Summary by auth mode", "");
  const authCounts = countAuthModes(catalog.routes);
  lines.push("| Auth mode | Count |", "|-----------|-------|");
  for (const [mode, count] of Object.entries(authCounts) as [AuthMode, number][]) {
    lines.push(`| ${AUTH_BADGE[mode]} | ${count} |`);
  }

  lines.push("", "## Non-JSON routes", "");
  const nonJson = nonJsonMethods(catalog.routes);
  if (nonJson.length === 0) {
    lines.push("_(none detected)_");
  } else {
    lines.push("| Path | Method | Format |", "|------|--------|--------|");
    for (const n of nonJson) {
      lines.push(`| \`${n.path}\` | ${n.method} | ${FORMAT_BADGE[n.format]} |`);
    }
  }

  lines.push("", "## Contract highlights", "");
  lines.push(
    "> Routes where static analysis could infer request or response contract details.",
    "> `null` fields indicate the contract was not statically discoverable (see module-level JSDoc for limitations).",
    "",
    "| Path | Method | Status | Response keys | Query params | Body fields |",
    "|------|--------|--------|---------------|--------------|-------------|",
  );
  for (const route of catalog.routes) {
    for (const m of route.methods) {
      const hasContract =
        m.responseKeys !== null || m.queryParamNames !== null || m.bodyFieldNames !== null;
      if (!hasContract) continue;
      lines.push(
        `| \`${route.path}\` | ${m.method} | ${m.successStatus} | ${nullableList(m.responseKeys)} | ${nullableList(m.queryParamNames)} | ${nullableList(m.bodyFieldNames)} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
