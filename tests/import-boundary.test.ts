/**
 * Import boundary tests — REF-076.
 *
 * Verifies that the custom ESLint rule `readwise/no-server-imports-in-client`
 * correctly enforces client/server module boundaries.
 *
 * Acceptance check (from issue #513):
 *   "A boundary check fails on a fixture client component importing @/lib/prisma."
 *
 * Coverage:
 *   - "use client" file importing @/lib/prisma → rule must report a violation.
 *   - "use client" file importing other server-only modules → violations reported.
 *   - "use client" file importing client-safe modules → no violations.
 *   - Server component (no directive) importing @/lib/prisma → no violations.
 *   - Plain module (no directive) importing server-only modules → no violations.
 *   - additionalModules option → custom server-only modules are enforced.
 *   - High-risk Phase 1 boundaries: @/lib/cache and @/lib/ai/* internals.
 *   - Allowlisted entry is permitted (via import-boundary-allowlist.json).
 *   - Safe primitives and feature-local helpers are not flagged.
 *
 * These tests run in Node.js using the ESLint programmatic Linter API.
 * No database, network, AI, or storage dependencies.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Load the custom rule from the project root.
const ruleModule = require(
  resolve(__dirname, "../eslint-rules/no-server-imports-in-client.js")
);

type LintMessage = { messageId: string; message: string };
type ImportBoundaryRuleOptions = { additionalModules?: string[] };

function toLintMessages(messages: ReturnType<Linter["verify"]>): LintMessage[] {
  return messages.map((m) => ({ messageId: m.messageId ?? "", message: m.message }));
}

function ruleConfig(
  options?: ImportBoundaryRuleOptions,
  files?: Linter.Config["files"],
): Linter.Config {
  const configuredRule: Linter.RuleEntry = options ? ["error", options] : "error";

  return {
    ...(files ? { files } : {}),
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: {
      readwise: { rules: { "no-server-imports-in-client": ruleModule } },
    },
    rules: {
      "readwise/no-server-imports-in-client": configuredRule,
    },
  };
}

function expectViolationFor(source: string, moduleName: string): void {
  const messages = lint(source);
  assert.ok(messages.length > 0, "Expected at least one lint error");
  assert.ok(
    messages.some((m) => m.message.includes(moduleName)),
    `Expected message about ${moduleName}, got: ${JSON.stringify(messages)}`,
  );
}

function expectNoViolations(source: string): void {
  const messages = lint(source);
  assert.strictEqual(messages.length, 0, `Expected no lint errors, got: ${JSON.stringify(messages)}`);
}

/** Run the rule against a source string and return the list of messages. */
function lint(source: string): LintMessage[] {
  const linter = new Linter({ configType: "flat" });
  return toLintMessages(linter.verify(source, ruleConfig()));
}

/** Run the rule against a source string with a specific filename (for allowlist matching). */
function lintAs(source: string, filename: string): LintMessage[] {
  // ESLint 9 flat config requires (a) `cwd` in the Linter constructor, (b) an
  // absolute filename, and (c) at least one config `files` pattern that matches
  // the absolute path — only then does the allowlist path check work correctly.
  const absFilename = resolve(__dirname, "..", filename);
  const linter = new Linter({ configType: "flat", cwd: resolve(__dirname, "..") });
  const messages = linter.verify(
    source,
    ruleConfig(undefined, ["**/*.{ts,tsx,js,jsx}"]),
    absFilename,
  );
  return toLintMessages(messages);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_IMPORTS_PRISMA = `
"use client";
import { prisma } from "@/lib/prisma";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_SESSION = `
"use client";
import { requireSession } from "@/lib/session";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_RUNTIME_CONFIG = `
"use client";
import * as runtimeConfig from "@/lib/runtime-config";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_RUNTIME_CONFIG_SUBMODULE = `
"use client";
import { aiConfig } from "@/lib/runtime-config/ai";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_OBSERVABILITY = `
"use client";
import { createLogger } from "@/lib/observability/logger";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_OBSERVABILITY_BARREL = `
"use client";
import { createLogger } from "@/lib/observability";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_SECURITY = `
"use client";
import { recordAuditEvent } from "@/lib/security/audit";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_SERVER_PRIMITIVES = `
"use client";
import { sanitizeArticleHtml } from "@/lib/primitives/server";
export default function Widget() { return null; }
`.trim();

// ── New high-risk fixtures (Phase 1 — Issue #678) ─────────────────────────────

const CLIENT_IMPORTS_CACHE = `
"use client";
import { createCachedListing } from "@/lib/cache";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_PROVIDER = `
"use client";
import { AiProvider } from "@/lib/ai/provider";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_REGISTRY = `
"use client";
import { getAiProvider } from "@/lib/ai/registry";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_RUNNER = `
"use client";
import { runWithRetry } from "@/lib/ai/runner";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_AZURE_PROVIDER = `
"use client";
import { AzureOpenAiProvider } from "@/lib/ai/azure-provider";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_BUDGET = `
"use client";
import { checkBudget } from "@/lib/ai/budget";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_AI_LEDGER = `
"use client";
import { recordUsage } from "@/lib/ai/ledger";
export default function Widget() { return null; }
`.trim();

// These are client-safe — no violation expected.
const CLIENT_IMPORTS_STORAGE_KEYS = `
"use client";
import { STORAGE_KEYS, lsGet } from "@/lib/storage-keys";
export default function Widget() { return null; }
`.trim();

const CLIENT_IMPORTS_CN = `
"use client";
import { cn } from "@/lib/cn";
export default function Widget() { return null; }
`.trim();

// Server component (no "use client") importing Prisma — always allowed.
const SERVER_COMPONENT_IMPORTS_PRISMA = `
import { prisma } from "@/lib/prisma";
export default async function Page() { return null; }
`.trim();

// Plain module (no directive) importing a server module — allowed.
const SERVER_MODULE_IMPORTS_SESSION = `
import { requireSession } from "@/lib/session";
export async function getUser() { return requireSession("/"); }
`.trim();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("readwise/no-server-imports-in-client", () => {
  // ── Violations ─────────────────────────────────────────────────────────────

  test("reports error when 'use client' file imports @/lib/prisma", () => {
    expectViolationFor(CLIENT_IMPORTS_PRISMA, "@/lib/prisma");
  });

  test("reports error when 'use client' file imports @/lib/session", () => {
    expectViolationFor(CLIENT_IMPORTS_SESSION, "@/lib/session");
  });

  test("reports error when 'use client' file imports @/lib/runtime-config", () => {
    expectViolationFor(CLIENT_IMPORTS_RUNTIME_CONFIG, "@/lib/runtime-config");
  });

  test("reports error when 'use client' file imports @/lib/runtime-config/ai (submodule)", () => {
    expectViolationFor(CLIENT_IMPORTS_RUNTIME_CONFIG_SUBMODULE, "@/lib/runtime-config/ai");
  });

  test("reports error when 'use client' file imports @/lib/observability/logger", () => {
    expectViolationFor(CLIENT_IMPORTS_OBSERVABILITY, "@/lib/observability/logger");
  });

  test("reports error when 'use client' file imports @/lib/observability", () => {
    expectViolationFor(CLIENT_IMPORTS_OBSERVABILITY_BARREL, "@/lib/observability");
  });

  test("reports error when 'use client' file imports @/lib/security/audit", () => {
    expectViolationFor(CLIENT_IMPORTS_SECURITY, "@/lib/security/audit");
  });

  test("reports error when 'use client' file imports @/lib/primitives/server", () => {
    expectViolationFor(CLIENT_IMPORTS_SERVER_PRIMITIVES, "@/lib/primitives/server");
  });

  // ── Phase 1 high-risk boundaries (Issue #678) ───────────────────────────────

  test("reports error when 'use client' file imports @/lib/cache", () => {
    expectViolationFor(CLIENT_IMPORTS_CACHE, "@/lib/cache");
  });

  test("reports error when 'use client' file imports @/lib/ai/provider", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_PROVIDER, "@/lib/ai/provider");
  });

  test("reports error when 'use client' file imports @/lib/ai/registry", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_REGISTRY, "@/lib/ai/registry");
  });

  test("reports error when 'use client' file imports @/lib/ai/runner", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_RUNNER, "@/lib/ai/runner");
  });

  test("reports error when 'use client' file imports @/lib/ai/azure-provider", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_AZURE_PROVIDER, "@/lib/ai/azure-provider");
  });

  test("reports error when 'use client' file imports @/lib/ai/budget", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_BUDGET, "@/lib/ai/budget");
  });

  test("reports error when 'use client' file imports @/lib/ai/ledger", () => {
    expectViolationFor(CLIENT_IMPORTS_AI_LEDGER, "@/lib/ai/ledger");
  });

  // ── No violations ───────────────────────────────────────────────────────────

  test("no error when 'use client' file imports client-safe @/lib/storage-keys", () => {
    expectNoViolations(CLIENT_IMPORTS_STORAGE_KEYS);
  });

  test("no error when 'use client' file imports client-safe @/lib/cn", () => {
    expectNoViolations(CLIENT_IMPORTS_CN);
  });

  test("no error when server component (no directive) imports @/lib/prisma", () => {
    const messages = lint(SERVER_COMPONENT_IMPORTS_PRISMA);
    assert.strictEqual(
      messages.length,
      0,
      `Next.js server components must be allowed to import Prisma. Got: ${JSON.stringify(messages)}`
    );
  });

  test("no error when plain server module imports @/lib/session", () => {
    expectNoViolations(SERVER_MODULE_IMPORTS_SESSION);
  });

  // ── additionalModules option ────────────────────────────────────────────────

  test("additionalModules option enforces caller-supplied server-only modules", () => {
    const source = `
"use client";
import { something } from "@/lib/my-custom-server-module";
export default function Widget() { return null; }
`.trim();

    const linter = new Linter({ configType: "flat" });
    const messages = linter.verify(
      source,
      ruleConfig({ additionalModules: ["@/lib/my-custom-server-module"] }),
    );
    assert.ok(messages.length > 0, "Expected violation for custom module");
    assert.ok(messages.some((m) => m.message.includes("@/lib/my-custom-server-module")));
  });

  test("additionalModules does not block safe imports when list is empty", () => {
    const source = `
"use client";
import { cn } from "@/lib/cn";
export default function Widget() { return null; }
`.trim();

    const linter = new Linter({ configType: "flat" });
    const messages = linter.verify(source, ruleConfig({ additionalModules: [] }));
    assert.strictEqual(messages.length, 0);
  });

  // ── Allowlist: documented exception is permitted ────────────────────────────

  test("allowlisted file importing a server-only module is NOT flagged", () => {
    // The test fixture path matches the allowlist entry in
    // eslint-rules/import-boundary-allowlist.json, so no violation is reported.
    const allowlistedSource = `
"use client";
import { prisma } from "@/lib/prisma";
export default function Widget() { return null; }
`.trim();

    const messages = lintAs(allowlistedSource, "tests/fixtures/allowlist-boundary-test.tsx");
    assert.strictEqual(
      messages.length,
      0,
      `Allowlisted file must not be flagged. Got: ${JSON.stringify(messages)}`,
    );
  });

  test("non-allowlisted file with same server-only import IS flagged", () => {
    // A different file path — not in the allowlist — must still be caught.
    const messages = lintAs(CLIENT_IMPORTS_PRISMA, "src/components/SomeWidget.tsx");
    assert.ok(messages.length > 0, "Non-allowlisted file must be flagged");
    assert.ok(messages.some((m) => m.message.includes("@/lib/prisma")));
  });

  // ── Allowlist JSON schema validation ───────────────────────────────────────

  test("import-boundary-allowlist.json is valid JSON with required entry shape", () => {
    const allowlistPath = resolve(__dirname, "../eslint-rules/import-boundary-allowlist.json");
    const raw = JSON.parse(readFileSync(allowlistPath, "utf-8")) as {
      allowlist?: Array<{
        importer?: unknown;
        privateModule?: unknown;
        reason?: unknown;
        owner?: unknown;
        removalCondition?: unknown;
      }>;
    };
    assert.ok(Array.isArray(raw.allowlist), "allowlist must be an array");
    for (const entry of raw.allowlist!) {
      assert.ok(typeof entry.importer === "string", "importer must be a string");
      assert.ok(typeof entry.privateModule === "string", "privateModule must be a string");
      assert.ok(typeof entry.reason === "string", "reason must be a string");
      assert.ok(typeof entry.owner === "string", "owner must be a string");
      assert.ok(typeof entry.removalCondition === "string", "removalCondition must be a string");
    }
  });

  // ── Safe feature-local helpers and pure primitives ─────────────────────────

  test("no error when 'use client' file imports a feature-local hook", () => {
    const source = `
"use client";
import { useLocalStorage } from "@/hooks/use-local-storage";
export default function Widget() { return null; }
`.trim();
    const messages = lint(source);
    assert.strictEqual(messages.length, 0);
  });

  test("no error when 'use client' file imports a UI utility", () => {
    const source = `
"use client";
import { formatDate } from "@/lib/date-utils";
export default function Widget() { return null; }
`.trim();
    const messages = lint(source);
    assert.strictEqual(messages.length, 0);
  });

  test("no error when 'use client' file imports a client-safe @/lib/utils module", () => {
    const source = `
"use client";
import { clamp, debounce } from "@/lib/utils";
export default function Widget() { return null; }
`.trim();
    const messages = lint(source);
    assert.strictEqual(messages.length, 0);
  });
});
