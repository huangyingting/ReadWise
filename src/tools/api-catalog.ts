/**
 * API catalog builder (REF-070).
 *
 * Scans every `src/app/api/**\/route.ts` file, extracts exported HTTP methods
 * and handler metadata (auth mode, schemas, capability, runtime, response
 * format), and returns a structured {@link ApiCatalog}.
 *
 * This module is imported by:
 *   - `scripts/generate-api-catalog.ts` — CLI that writes the catalog files.
 *   - `tests/api-catalog-drift.test.ts` — drift-detection test.
 *
 * The implementation is pure static-analysis (regex/string scanning); it never
 * loads or evaluates route modules, so it does not require a database, Next.js
 * context, or any environment variable.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repo root (two levels up from src/lib). */
const ROOT = resolve(__dirname, "../..");
const API_ROOT = join(ROOT, "src", "app", "api");

// ── Public types ──────────────────────────────────────────────────────────

export type AuthMode = "public" | "session" | "admin" | "capability";
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

  // Detect schema presence in the config window immediately after the match.
  const configWindow = source.slice(match.index, match.index + 500);
  const hasBodySchema = /\bbody\s*:/.test(configWindow);
  const hasParamsSchema = /\bparams\s*:/.test(configWindow);
  const hasQuerySchema = /\bquery\s*:/.test(configWindow);

  const responseFormat = detectResponseFormat(source);

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
  const lines: string[] = [
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
    "| Path | Method | Auth | Schemas | Response | Runtime | Notes |",
    "|------|--------|------|---------|----------|---------|-------|",
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
        `| \`${route.path}\` | ${m.method} | ${AUTH_BADGE[m.authMode]} | ${schemas || "—"} | ${FORMAT_BADGE[m.responseFormat]} | ${runtime} | ${notes} |`,
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

  lines.push("");
  return lines.join("\n");
}
