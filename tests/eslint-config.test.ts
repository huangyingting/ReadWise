import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

test("ESLint ignores every Next.js build output directory", async () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  for (const generatedPath of [
    ".next/dev/server/webpack-runtime.js",
    ".next-e2e/dev/server/webpack-runtime.js",
  ]) {
    assert.equal(
      await eslint.isPathIgnored(generatedPath),
      true,
      `${generatedPath} must not be treated as repository source`,
    );
  }
});
