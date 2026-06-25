/**
 * Unit tests for scripts/ts-resolve-hook.mjs (REF-079).
 *
 * Covers the three resolution behaviours the hook implements:
 *   1. @/* alias  →  src/<path>.ts
 *   2. Extensionless relative imports  →  <file>.ts / <dir>/index.ts
 *   3. Package subpath retry on ERR_MODULE_NOT_FOUND
 *
 * The hook is tested by calling its exported `resolve()` function directly,
 * using real project files as fixtures so no additional mock file-system
 * setup is required.
 */
process.env.LOG_LEVEL = "error";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { resolve } = await import("../scripts/ts-resolve-hook.mjs");

const projectRoot = path.resolve(process.cwd());
/** A nextResolve stub that short-circuits immediately — used for alias tests. */
const passthrough = async (specifier: string) => ({
  url: specifier,
  shortCircuit: true,
});

// ── @/* alias resolution ──────────────────────────────────────────────────

describe("@/* alias resolution", async () => {
  test("resolves @/lib/prisma to src/lib/prisma.ts", async () => {
    const result = await resolve("@/lib/prisma", {}, passthrough);
    const expected = pathToFileURL(
      path.join(projectRoot, "src/lib/prisma.ts"),
    ).href;
    assert.equal(result.url, expected);
    assert.equal(result.shortCircuit, true);
  });

  test("resolves @/lib/observability/logger to src/lib/observability/logger.ts", async () => {
    const result = await resolve("@/lib/observability/logger", {}, passthrough);
    assert.ok(
      result.url.endsWith("src/lib/observability/logger.ts"),
      `expected logger.ts, got ${result.url}`,
    );
    assert.equal(result.shortCircuit, true);
  });

  test("falls through to nextResolve when @/* target does not exist", async () => {
    let called = false;
    const next = async (spec: string) => {
      called = true;
      return { url: `resolved:${spec}`, shortCircuit: true };
    };
    await resolve("@/nonexistent/module", {}, next);
    assert.equal(called, true);
  });
});

// ── Extensionless relative import resolution ──────────────────────────────

describe("extensionless relative import resolution", async () => {
  test("resolves ./lib/cli to scripts/lib/cli.ts given a scripts/ parent", async () => {
    const parentURL = pathToFileURL(
      path.join(projectRoot, "scripts/seed.ts"),
    ).href;
    const result = await resolve("./lib/cli", { parentURL }, passthrough);
    const expected = pathToFileURL(
      path.join(projectRoot, "scripts/lib/cli.ts"),
    ).href;
    assert.equal(result.url, expected);
    assert.equal(result.shortCircuit, true);
  });

  test("resolves relative path with explicit .ts extension unchanged", async () => {
    const parentURL = pathToFileURL(
      path.join(projectRoot, "scripts/seed.ts"),
    ).href;
    const result = await resolve("./lib/cli.ts", { parentURL }, passthrough);
    const expected = pathToFileURL(
      path.join(projectRoot, "scripts/lib/cli.ts"),
    ).href;
    assert.equal(result.url, expected);
    assert.equal(result.shortCircuit, true);
  });

  test("resolves directory import to index.ts when index file exists", async () => {
    // src/lib/worker/ has an index.ts
    const parentURL = pathToFileURL(
      path.join(projectRoot, "scripts/worker.ts"),
    ).href;
    const result = await resolve("@/lib/worker", { parentURL }, passthrough);
    assert.ok(
      result.url.includes("src/lib/worker"),
      `expected worker path, got ${result.url}`,
    );
    assert.equal(result.shortCircuit, true);
  });
});

// ── Package subpath retry on ERR_MODULE_NOT_FOUND ─────────────────────────

describe("package subpath retry", async () => {
  test("retries a bare specifier with .js extension when nextResolve fails", async () => {
    let callCount = 0;
    const nextResolve = async (spec: string) => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("module not found") as NodeJS.ErrnoException;
        err.code = "ERR_MODULE_NOT_FOUND";
        throw err;
      }
      return { url: `resolved:${spec}`, shortCircuit: true };
    };

    const result = await resolve("some-package/subpath", {}, nextResolve);
    assert.equal(result.url, "resolved:some-package/subpath.js");
    assert.equal(callCount, 2); // initial fail + one retry
  });

  test("re-throws when all retries fail", async () => {
    const err = new Error("persistent not found") as NodeJS.ErrnoException;
    err.code = "ERR_MODULE_NOT_FOUND";
    const alwaysFail = async () => {
      throw err;
    };

    await assert.rejects(
      () => resolve("no-such-package/subpath", {}, alwaysFail),
      (thrown: Error) => {
        assert.equal(
          (thrown as NodeJS.ErrnoException).code,
          "ERR_MODULE_NOT_FOUND",
        );
        return true;
      },
    );
  });

  test("does not retry specifiers with a recognised extension", async () => {
    let callCount = 0;
    const nextResolve = async (spec: string) => {
      callCount++;
      const err = new Error("not found") as NodeJS.ErrnoException;
      err.code = "ERR_MODULE_NOT_FOUND";
      throw err;
    };

    await assert.rejects(
      () => resolve("some-package/file.js", {}, nextResolve),
    );
    // The regex !/\.[mc]?jsx?$/.test(specifier) means .js files are not retried
    assert.equal(callCount, 1);
  });
});
