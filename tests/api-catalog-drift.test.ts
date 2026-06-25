/**
 * API catalog drift-detection test (REF-070).
 *
 * Regenerates the API catalog in-memory and compares the route/method
 * inventory against the committed `docs/platform/api-catalog.json`.  The test fails
 * when:
 *   - A new route.ts file is added without running `npm run api-catalog`.
 *   - An existing route changes its handler wrapper (auth mode) without
 *     regenerating the catalog.
 *   - The catalog file is deleted or corrupted.
 *
 * To fix a failing test: run `npm run api-catalog` and commit the result.
 *
 * Run with: npm test -- --test-name-pattern "api-catalog"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCatalog } from "@/lib/api-catalog";
import type { ApiCatalog, RouteEntry, MethodEntry } from "@/lib/api-catalog";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const CATALOG_PATH = join(ROOT, "docs", "platform", "api-catalog.json");

// ── Helpers ───────────────────────────────────────────────────────────────

/** Strip volatile timestamp before comparison. */
function stripTimestamp(catalog: ApiCatalog): Omit<ApiCatalog, "generatedAt"> {
  const { generatedAt: _, ...rest } = catalog;
  return rest;
}

/** Stable key for a method entry (for diff messages). */
function methodKey(r: RouteEntry, m: MethodEntry): string {
  return `${m.method} ${r.path}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("docs/platform/api-catalog.json exists and is valid JSON", () => {
  let raw: string;
  try {
    raw = readFileSync(CATALOG_PATH, "utf8");
  } catch {
    assert.fail(
      `docs/platform/api-catalog.json not found — run \`npm run api-catalog\` and commit the result`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    assert.fail("docs/platform/api-catalog.json is not valid JSON");
  }
  assert.ok(
    parsed && typeof parsed === "object" && "routes" in (parsed as object),
    "docs/platform/api-catalog.json is missing the 'routes' field",
  );
});

test("api-catalog: committed catalog matches current route files (drift detection)", () => {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const committed: ApiCatalog = JSON.parse(raw);
  const current = buildCatalog();

  const committedNorm = stripTimestamp(committed);
  const currentNorm = stripTimestamp(current);

  // Route count check with actionable message.
  if (committedNorm.routeCount !== currentNorm.routeCount) {
    const committedPaths = new Set(committed.routes.map((r) => r.path));
    const currentPaths = new Set(current.routes.map((r) => r.path));

    const added = [...currentPaths].filter((p) => !committedPaths.has(p));
    const removed = [...committedPaths].filter((p) => !currentPaths.has(p));

    const details = [
      added.length > 0 ? `Added routes: ${added.join(", ")}` : "",
      removed.length > 0 ? `Removed routes: ${removed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    assert.fail(
      `API catalog is stale — route count changed from ${committedNorm.routeCount} to ${currentNorm.routeCount}.\n` +
        details +
        "\nFix: run `npm run api-catalog` and commit docs/platform/api-catalog.json",
    );
  }

  // Method count check.
  if (committedNorm.methodCount !== currentNorm.methodCount) {
    assert.fail(
      `API catalog is stale — method count changed from ${committedNorm.methodCount} to ${currentNorm.methodCount}.\n` +
        "Fix: run `npm run api-catalog` and commit docs/platform/api-catalog.json",
    );
  }

  // Per-route deep comparison.
  const committedByPath = new Map(committed.routes.map((r) => [r.path, r]));
  const currentByPath = new Map(current.routes.map((r) => [r.path, r]));
  const drifted: string[] = [];

  for (const [path, currentRoute] of currentByPath) {
    const committedRoute = committedByPath.get(path);
    if (!committedRoute) {
      drifted.push(`  + new route: ${path}`);
      continue;
    }

    // Compare per-method entries by method name.
    const committedMethods = new Map(committedRoute.methods.map((m) => [m.method, m]));
    const currentMethods = new Map(currentRoute.methods.map((m) => [m.method, m]));

    for (const [method, cur] of currentMethods) {
      const com = committedMethods.get(method);
      if (!com) {
        drifted.push(`  + new method: ${method} ${path}`);
        continue;
      }
      if (com.authMode !== cur.authMode) {
        drifted.push(
          `  ~ auth mode changed for ${methodKey(currentRoute, cur)}: ${com.authMode} → ${cur.authMode}`,
        );
      }
      if (com.capability !== cur.capability) {
        drifted.push(
          `  ~ capability changed for ${methodKey(currentRoute, cur)}: ${com.capability} → ${cur.capability}`,
        );
      }
      if (com.responseFormat !== cur.responseFormat) {
        drifted.push(
          `  ~ response format changed for ${methodKey(currentRoute, cur)}: ${com.responseFormat} → ${cur.responseFormat}`,
        );
      }
      if (
        com.hasBodySchema !== cur.hasBodySchema ||
        com.hasParamsSchema !== cur.hasParamsSchema ||
        com.hasQuerySchema !== cur.hasQuerySchema
      ) {
        drifted.push(`  ~ schema flags changed for ${methodKey(currentRoute, cur)}`);
      }
    }

    for (const method of committedMethods.keys()) {
      if (!currentMethods.has(method)) {
        drifted.push(`  - removed method: ${method} ${path}`);
      }
    }

    if (committedRoute.runtime !== currentRoute.runtime) {
      drifted.push(
        `  ~ runtime changed for ${path}: ${committedRoute.runtime} → ${currentRoute.runtime}`,
      );
    }
  }

  for (const path of committedByPath.keys()) {
    if (!currentByPath.has(path)) {
      drifted.push(`  - removed route: ${path}`);
    }
  }

  if (drifted.length > 0) {
    assert.fail(
      "API catalog is stale — the following changes were detected:\n" +
        drifted.join("\n") +
        "\n\nFix: run `npm run api-catalog` and commit docs/platform/api-catalog.json + docs/platform/api-catalog.md",
    );
  }
});

test("api-catalog: all routes have at least one method handler", () => {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const catalog: ApiCatalog = JSON.parse(raw);

  const empty = catalog.routes.filter((r) => r.methods.length === 0).map((r) => r.path);
  assert.deepEqual(
    empty,
    [],
    `Routes with no method handlers: ${empty.join(", ")} — re-run \`npm run api-catalog\``,
  );
});

test("api-catalog: catalog route count matches reported routeCount field", () => {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const catalog: ApiCatalog = JSON.parse(raw);

  assert.equal(
    catalog.routes.length,
    catalog.routeCount,
    `catalog.routeCount=${catalog.routeCount} but catalog.routes has ${catalog.routes.length} entries`,
  );
});

test("api-catalog: catalog method count matches reported methodCount field", () => {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const catalog: ApiCatalog = JSON.parse(raw);

  const actual = catalog.routes.reduce((n, r) => n + r.methods.length, 0);
  assert.equal(
    actual,
    catalog.methodCount,
    `catalog.methodCount=${catalog.methodCount} but sum of route methods is ${actual}`,
  );
});

test("api-catalog: auth/[...nextauth] route is marked as nextauth response format", () => {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const catalog: ApiCatalog = JSON.parse(raw);

  const nextauthRoute = catalog.routes.find((r) => r.path.includes("nextauth"));
  assert.ok(
    nextauthRoute,
    "NextAuth route not found in catalog — expected a route matching *nextauth*",
  );
  for (const m of nextauthRoute.methods) {
    assert.equal(
      m.responseFormat,
      "nextauth",
      `NextAuth route method ${m.method} should have responseFormat="nextauth"`,
    );
  }
});
