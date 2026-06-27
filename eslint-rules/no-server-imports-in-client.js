/**
 * ESLint rule: no-server-imports-in-client (REF-076)
 *
 * Forbids "use client" files from importing server-only modules.
 *
 * Server-only modules include: Prisma, auth/session guards, Node APIs,
 * logger, tracing, audit, runtime-config, cache, AI internals, and server
 * storage adapters.
 *
 * ── Legitimate exceptions ─────────────────────────────────────────────────
 * Next.js `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, etc. are
 * server components by default (no "use client" directive). These files CAN
 * safely import server-only modules and are not subject to this rule.
 *
 * Only files with an explicit `"use client"` directive at the top are checked.
 *
 * To suppress a single line when there is a genuine, reviewed exception:
 *   // eslint-disable-next-line readwise/no-server-imports-in-client -- reason
 *
 * To document a durable exception, add an entry to
 * eslint-rules/import-boundary-allowlist.json with the shape:
 *   { "importer": "src/path/to/file.tsx", "privateModule": "@/lib/foo",
 *     "reason": "...", "owner": "@handle", "removalCondition": "..." }
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Load allowlist ────────────────────────────────────────────────────────────

/** @type {Array<{importer: string, privateModule: string, reason: string, owner: string, removalCondition: string}>} */
let allowlistEntries = [];
try {
  const allowlistPath = path.resolve(__dirname, "import-boundary-allowlist.json");
  const raw = JSON.parse(fs.readFileSync(allowlistPath, "utf-8"));
  allowlistEntries = Array.isArray(raw.allowlist) ? raw.allowlist : [];
} catch {
  // Allowlist file missing or malformed — fail closed (no exceptions granted).
  allowlistEntries = [];
}

// ── Server-only module registry ───────────────────────────────────────────────

/**
 * Exact import paths that must never appear in client components.
 * Add to this list as new server-only modules are introduced.
 */
const SERVER_ONLY_EXACT = new Set([
  // Prisma database client
  "@/lib/prisma",
  // Auth modules (NextAuth config, session guards, API auth)
  "@/lib/auth",
  "@/lib/auth-core",
  "@/lib/auth-bootstrap",
  "@/lib/auth-providers",
  "@/lib/session",
  "@/lib/api-auth",
  // Logging / observability (structured JSON logs, request context)
  "@/lib/logger",
  "@/lib/tracing",
  "@/lib/tracing-node",
  // Audit logging
  "@/lib/audit",
  // HTML sanitizer (sanitize-html — Node.js only)
  "@/lib/sanitize",
  // Rate limiting (Redis/memory store, Node.js only)
  "@/lib/rate-limit",
  "@/lib/rate-limit-store",
  // Server primitives barrel
  "@/lib/primitives/server",
  // Media object-storage façade (Azure Blob / filesystem — Node.js only)
  "@/lib/storage",
  // Server-level seed helpers
  "@/lib/seed",
  // Next.js server cache (unstable_cache / revalidateTag — server only)
  "@/lib/cache",
  // AI internals: provider abstraction, registry, and runner are server-only;
  // external code should use the stable @/lib/ai facade instead.
  "@/lib/ai/provider",
  "@/lib/ai/azure-provider",
  "@/lib/ai/registry",
  "@/lib/ai/runner",
  "@/lib/ai/budget",
  "@/lib/ai/ledger",
]);

/**
 * Prefix patterns — any import whose source equals the prefix or starts with
 * the prefix followed by "/" is treated as server-only.
 *
 * E.g. "@/lib/runtime-config" catches both:
 *   import "@/lib/runtime-config"
 *   import "@/lib/runtime-config/ai"
 */
const SERVER_ONLY_PREFIXES = [
  "@/lib/runtime-config",
  "@/lib/observability",
  "@/lib/security",
  "@/lib/storage/",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if `source` resolves to a server-only module. */
function isServerOnly(source) {
  if (SERVER_ONLY_EXACT.has(source)) return true;
  for (const prefix of SERVER_ONLY_PREFIXES) {
    if (source === prefix || source.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the given importer/module combination has an explicit
 * allowlist entry in eslint-rules/import-boundary-allowlist.json.
 *
 * `importerPath` is the absolute path of the file being linted.
 * `source` is the import specifier (e.g. "@/lib/cache").
 */
function isAllowlisted(importerPath, source) {
  if (!importerPath || allowlistEntries.length === 0) return false;
  const normalized = importerPath.replace(/\\/g, "/");
  return allowlistEntries.some(
    (entry) =>
      typeof entry.importer === "string" &&
      typeof entry.privateModule === "string" &&
      entry.privateModule === source &&
      normalized.endsWith(entry.importer.replace(/\\/g, "/"))
  );
}

// ── Rule definition ───────────────────────────────────────────────────────────

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Forbid server-only module imports inside "use client" files (REF-076)',
      category: "Import Boundaries",
      recommended: true,
      url: "https://github.com/huangyingting/ReadWise/issues/513",
    },
    messages: {
      serverImportInClient:
        '"{{source}}" is a server-only module and cannot be imported in a "use client" file. ' +
        "Server-only modules include Prisma, auth/session guards, Node APIs, logger, " +
        "tracing, audit, runtime-config, cache, AI internals, and server storage adapters. " +
        "See docs/architecture/0010-subsystem-boundaries-and-import-contracts.md for the boundary taxonomy. " +
        "To document a durable exception add an entry to eslint-rules/import-boundary-allowlist.json.",
    },
    schema: [
      {
        type: "object",
        properties: {
          // Allow callers to extend the list with project-specific modules.
          additionalModules: {
            type: "array",
            items: { type: "string" },
            default: [],
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    let isClientFile = false;

    // Merge in any caller-supplied additional modules.
    const options = context.options[0] || {};
    const extra = new Set(options.additionalModules || []);

    // Resolve the file being linted (ESLint ≥ 8 uses context.filename).
    const importerPath =
      (typeof context.filename === "string" ? context.filename : null) ||
      (typeof context.getFilename === "function" ? context.getFilename() : null) ||
      "";

    function checkSource(source) {
      if (isServerOnly(source) || extra.has(source)) return true;
      return false;
    }

    return {
      /**
       * Determine whether this file is a client component by checking for a
       * "use client" directive as the first statement.
       *
       * Next.js server components (page.tsx, layout.tsx, route.ts, …) do NOT
       * have this directive and are therefore not checked by this rule.
       */
      Program(node) {
        if (node.body.length === 0) return;
        const first = node.body[0];
        if (
          first.type === "ExpressionStatement" &&
          first.expression.type === "Literal" &&
          first.expression.value === "use client"
        ) {
          isClientFile = true;
        }
      },

      ImportDeclaration(node) {
        if (!isClientFile) return;
        const source = node.source.value;
        if (typeof source === "string" && checkSource(source)) {
          // Allow if there is an explicit allowlist entry for this file+module.
          if (isAllowlisted(importerPath, source)) return;
          context.report({
            node: node.source,
            messageId: "serverImportInClient",
            data: { source },
          });
        }
      },
    };
  },
};

module.exports = rule;

