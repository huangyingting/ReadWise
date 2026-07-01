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
 * - `successStatus`: reliably extracted when the route returns an explicit
 *   `status: 204/201` literal; defaults to 200 otherwise.
 * - `responseKeys`: extracted from the first `NextResponse.json({ ... })` call
 *   in the handler; `null` when the argument is a variable/expression.
 * - `queryParamNames`: extracted from `queryString/queryInt/queryBool/queryFloat`
 *   helper calls and `params.get("name")` usages; `null` when the route
 *   delegates query parsing to an external function with no discoverable calls.
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

// ── Contract-extraction helpers ───────────────────────────────────────────

/**
 * Return the content between the first balanced `{...}` pair starting at
 * `openPos` in `source` (openPos must point at the `{` character).
 */
function sliceBracketContent(source: string, openPos: number): string {
  let depth = 0;
  let start = -1;
  for (let i = openPos; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      if (depth === 1) start = i + 1;
    } else if (ch === "}") {
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

  return [...new Set(keys)].sort();
}

/**
 * Detect the HTTP success status code from a handler source window.
 * Returns 204 when a `new (Next)Response(null, { status: 204 })` pattern is
 * found, 201 when `NextResponse.json({...}, { status: 201 })`, otherwise 200.
 */
function extractSuccessStatus(handlerWindow: string): number {
  if (
    /new\s+(?:Next)?Response\s*\(\s*null\s*,\s*\{[^}]*\bstatus\s*:\s*204\b/.test(handlerWindow)
  ) {
    return 204;
  }
  const jsonStatus = /NextResponse\.json\([^)]+,\s*\{\s*status\s*:\s*(\d{3})\s*\}/.exec(
    handlerWindow,
  );
  if (jsonStatus) return parseInt(jsonStatus[1], 10);
  return 200;
}

/**
 * Extract top-level response keys from the first `NextResponse.json({ ... })`
 * call in `handlerWindow`.  Returns `null` when the argument is not a literal
 * object (e.g. `NextResponse.json(result)`).
 */
function extractResponseKeys(handlerWindow: string): string[] | null {
  const re = /NextResponse\.json\(\s*\{/g;
  const match = re.exec(handlerWindow);
  if (!match) return null;

  const bracePos = handlerWindow.indexOf("{", match.index + "NextResponse.json(".length);
  if (bracePos === -1) return null;

  const body = sliceBracketContent(handlerWindow, bracePos);
  if (!body.trim()) return null;

  const keys = extractObjectKeyNames(body);
  return keys.length > 0 ? keys : null;
}

/**
 * Extract query-string parameter names from the method's source window.
 * Detects `queryString/queryInt/queryBool/queryFloat(params, "name")` and
 * `params.get("name")` patterns.
 */
function extractQueryParamNames(source: string): string[] | null {
  const names = new Set<string>();

  const helperRe = /\bquery(?:String|Int|Bool|Float)\s*\(\s*\w+\s*,\s*["'](\w+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = helperRe.exec(source)) !== null) names.add(m[1]);

  const getterRe = /\bparams\.get\(\s*["'](\w+)["']/g;
  while ((m = getterRe.exec(source)) !== null) names.add(m[1]);

  return names.size > 0 ? [...names].sort() : null;
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

  // Case 1: inline body schema — body: object({...})
  const inlineMatch = /\bbody\s*:\s*object\s*\(/.exec(configWindow);
  if (inlineMatch) {
    const bracePos = configWindow.indexOf("{", inlineMatch.index + inlineMatch[0].length);
    if (bracePos !== -1) {
      const body = sliceBracketContent(configWindow, bracePos);
      const keys = extractObjectKeyNames(body);
      if (keys.length > 0) return keys;
    }
  }

  // Case 2: body: varName — look up the variable definition in the full source.
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

function extractMethodEntry(method: string, source: string): MethodEntry | null {
  // Match: export const METHOD = createXxxHandler(...)
  const wrapperRe = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*(create(?:Admin|Public|Capability)?Handler)\\s*\\(`,
    "g",
  );
  const match = wrapperRe.exec(source);
  if (!match) return null;

  const wrapperName = match[1];
  const authMode: AuthMode =
    wrapperName === "createAdminHandler"
      ? "admin"
      : wrapperName === "createPublicHandler"
        ? "public"
        : wrapperName === "createCapabilityHandler"
          ? "capability"
          : "session";

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

  // Config window: 500 chars from the match start — covers the config object
  // for all handler types (including createCapabilityHandler where the config
  // is the second argument after the capability literal).
  const configWindow = source.slice(match.index, match.index + 500);
  const hasBodySchema = /\bbody\s*:/.test(configWindow);
  const hasParamsSchema = /\bparams\s*:/.test(configWindow);
  const hasQuerySchema = /\bquery\s*:/.test(configWindow);

  // Handler window: from the export to the next method export (or +5000 chars).
  // Used for success-status and response-key extraction.
  const nextMethodRe =
    /\nexport\s+const\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*=/g;
  nextMethodRe.lastIndex = match.index + 1;
  const nextMatch = nextMethodRe.exec(source);
  const handlerWindow = source.slice(
    match.index,
    nextMatch ? nextMatch.index : Math.min(match.index + 5000, source.length),
  );

  const responseFormat = detectResponseFormat(source);

  const successStatus = extractSuccessStatus(handlerWindow);
  const responseKeys = extractResponseKeys(handlerWindow);
  const queryParamNames = hasQuerySchema ? extractQueryParamNames(handlerWindow) : null;
  const bodyFieldNames = extractBodyFieldNames(configWindow, source);

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

function detectResponseFormat(source: string): ResponseFormat {
  if (/"audio\//.test(source) || /mimeType/.test(source)) return "binary";
  if (/text\/csv/.test(source)) return "text/csv";
  if (/text\/plain/.test(source)) return "text/plain";
  if (
    /Content-Disposition.*attachment/i.test(source) ||
    /content-disposition.*attachment/i.test(source)
  ) {
    return /\.json"/.test(source) ? "download-json" : "text/csv";
  }
  return "json";
}

// ── Route parser ──────────────────────────────────────────────────────────

function parseRouteFile(filePath: string): RouteEntry | null {
  const source = readFileSync(filePath, "utf8");
  const apiPath = fileToApiPath(filePath);
  const fileRel = relative(ROOT, filePath);

  // Special case: NextAuth catch-all route.
  if (/from\s+["']next-auth["']/.test(source) && /NextAuth/.test(source)) {
    const nextauthMethod = (method: string): MethodEntry => ({
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
    });
    return {
      path: apiPath,
      file: fileRel,
      runtime: "default",
      methods: [nextauthMethod("GET"), nextauthMethod("POST")],
    };
  }

  const runtimeMatch = /export\s+const\s+runtime\s*=\s*["']([\w-]+)["']/.exec(source);
  const runtime: RouteEntry["runtime"] =
    runtimeMatch?.[1] === "nodejs"
      ? "nodejs"
      : runtimeMatch?.[1] === "edge"
        ? "edge"
        : "default";

  const methods: MethodEntry[] = [];
  for (const method of HTTP_METHODS) {
    const entry = extractMethodEntry(method, source);
    if (entry) methods.push(entry);
  }

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

export function buildCatalogMarkdown(catalog: ApiCatalog): string {
  const updated = catalog.generatedAt.slice(0, 10);
  const lines: string[] = [
    "---",
    "title: \"ReadWise API Catalog\"",
    "category: \"Platform\"",
    "architecture: \"Generated inventory of Next.js API route boundaries, auth modes, schemas, and response formats.\"",
    "design: \"Generated from src/app/api route handlers by src/tools/api-catalog.ts; do not edit by hand.\"",
    "plan: \"Regenerate with npm run api-catalog whenever API routes or contracts change.\"",
    `updated: \"${updated}\"`,
    "rename: \"none\"",
    "---",
    "",
    "# ReadWise API Catalog",
    "",
    `> Auto-generated by \`npm run api-catalog\` — do not edit by hand.`,
    `> Last generated: ${catalog.generatedAt}`,
    "",
    `**${catalog.routeCount} routes · ${catalog.methodCount} method handlers**`,
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
      const schemas = [
        m.hasBodySchema ? "`B`" : "",
        m.hasParamsSchema ? "`P`" : "",
        m.hasQuerySchema ? "`Q`" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const runtime = route.runtime !== "default" ? route.runtime : "";
      const notes = m.notes.join("; ");
      lines.push(
        `| \`${route.path}\` | ${m.method} | ${AUTH_BADGE[m.authMode]} | ${schemas || "—"} | ${m.successStatus} | ${FORMAT_BADGE[m.responseFormat]} | ${runtime} | ${notes} |`,
      );
    }
  }

  lines.push("", "## Summary by auth mode", "");
  const authCounts: Record<AuthMode, number> = { public: 0, session: 0, admin: 0, capability: 0 };
  for (const r of catalog.routes) {
    for (const m of r.methods) authCounts[m.authMode]++;
  }
  lines.push("| Auth mode | Count |", "|-----------|-------|");
  for (const [mode, count] of Object.entries(authCounts) as [AuthMode, number][]) {
    lines.push(`| ${AUTH_BADGE[mode]} | ${count} |`);
  }

  lines.push("", "## Non-JSON routes", "");
  const nonJson = catalog.routes.flatMap((r) =>
    r.methods
      .filter((m) => m.responseFormat !== "json")
      .map((m) => ({ path: r.path, method: m.method, format: m.responseFormat })),
  );
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
      const rk = m.responseKeys ? m.responseKeys.join(", ") : "—";
      const qp = m.queryParamNames ? m.queryParamNames.join(", ") : "—";
      const bf = m.bodyFieldNames ? m.bodyFieldNames.join(", ") : "—";
      lines.push(
        `| \`${route.path}\` | ${m.method} | ${m.successStatus} | ${rk} | ${qp} | ${bf} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
