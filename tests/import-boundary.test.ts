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
 *
 * These tests run in Node.js using the ESLint programmatic Linter API.
 * No database, network, AI, or storage dependencies.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

/** Run the rule against a source string and return the list of messages. */
function lint(source: string): { messageId: string; message: string }[] {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(source, {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: {
      readwise: { rules: { "no-server-imports-in-client": ruleModule } },
    },
    rules: {
      "readwise/no-server-imports-in-client": "error",
    },
  });
  return messages.map((m) => ({ messageId: m.messageId ?? "", message: m.message }));
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

const CLIENT_IMPORTS_LOGGER = `
"use client";
import { createLogger } from "@/lib/logger";
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
    const messages = lint(CLIENT_IMPORTS_PRISMA);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(
      messages.some((m) => m.message.includes("@/lib/prisma")),
      `Expected message about @/lib/prisma, got: ${JSON.stringify(messages)}`
    );
  });

  test("reports error when 'use client' file imports @/lib/session", () => {
    const messages = lint(CLIENT_IMPORTS_SESSION);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/session")));
  });

  test("reports error when 'use client' file imports @/lib/logger", () => {
    const messages = lint(CLIENT_IMPORTS_LOGGER);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/logger")));
  });

  test("reports error when 'use client' file imports @/lib/runtime-config", () => {
    const messages = lint(CLIENT_IMPORTS_RUNTIME_CONFIG);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/runtime-config")));
  });

  test("reports error when 'use client' file imports @/lib/runtime-config/ai (submodule)", () => {
    const messages = lint(CLIENT_IMPORTS_RUNTIME_CONFIG_SUBMODULE);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/runtime-config/ai")));
  });

  test("reports error when 'use client' file imports @/lib/observability/logger", () => {
    const messages = lint(CLIENT_IMPORTS_OBSERVABILITY);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/observability/logger")));
  });

  test("reports error when 'use client' file imports @/lib/security/audit", () => {
    const messages = lint(CLIENT_IMPORTS_SECURITY);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/security/audit")));
  });

  test("reports error when 'use client' file imports @/lib/primitives/server", () => {
    const messages = lint(CLIENT_IMPORTS_SERVER_PRIMITIVES);
    assert.ok(messages.length > 0, "Expected at least one lint error");
    assert.ok(messages.some((m) => m.message.includes("@/lib/primitives/server")));
  });

  // ── No violations ───────────────────────────────────────────────────────────

  test("no error when 'use client' file imports client-safe @/lib/storage-keys", () => {
    const messages = lint(CLIENT_IMPORTS_STORAGE_KEYS);
    assert.strictEqual(
      messages.length,
      0,
      `Expected no lint errors, got: ${JSON.stringify(messages)}`
    );
  });

  test("no error when 'use client' file imports client-safe @/lib/cn", () => {
    const messages = lint(CLIENT_IMPORTS_CN);
    assert.strictEqual(messages.length, 0);
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
    const messages = lint(SERVER_MODULE_IMPORTS_SESSION);
    assert.strictEqual(messages.length, 0);
  });

  // ── additionalModules option ────────────────────────────────────────────────

  test("additionalModules option enforces caller-supplied server-only modules", () => {
    const source = `
"use client";
import { something } from "@/lib/my-custom-server-module";
export default function Widget() { return null; }
`.trim();

    const linter = new Linter({ configType: "flat" });
    const messages = linter.verify(source, {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: {
        readwise: { rules: { "no-server-imports-in-client": ruleModule } },
      },
      rules: {
        "readwise/no-server-imports-in-client": [
          "error",
          { additionalModules: ["@/lib/my-custom-server-module"] },
        ],
      },
    });
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
    const messages = linter.verify(source, {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: {
        readwise: { rules: { "no-server-imports-in-client": ruleModule } },
      },
      rules: {
        "readwise/no-server-imports-in-client": ["error", { additionalModules: [] }],
      },
    });
    assert.strictEqual(messages.length, 0);
  });
});
