/**
 * ESLint rule: no-server-imports-in-client (REF-076)
 *
 * Forbids "use client" files from importing server-only modules.
 *
 * Server-only modules include: Prisma, auth/session guards, Node APIs,
 * logger, tracing, audit, runtime-config, and server storage adapters.
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
 */

"use strict";

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

/** Returns true if `source` starts with the prefix (including "/"-delimited variant). */
// (used indirectly via isServerOnly)

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
        "tracing, audit, runtime-config, and server storage adapters. " +
        "See docs/refactoring.md § REF-076 for the boundary taxonomy.",
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
