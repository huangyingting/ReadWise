process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

const catalog = {
  generatedAt: "2026-07-11T08:08:13.000Z",
  routeCount: 2,
  methodCount: 3,
  routes: [],
};

test("generate-api-catalog helpers parse args and normalize volatile fields", async () => {
  const { parseArgs, contentHash, normalizeMarkdown, relativeCatalogPath } = await import(
    "../scripts/generate-api-catalog"
  );

  assert.deepEqual(parseArgs(["--dry-run", "--json-only"]), {
    dryRun: true,
    jsonOnly: true,
    mdOnly: false,
  });

  const oldHash = contentHash(catalog as never);
  const newHash = contentHash({ ...catalog, generatedAt: "different" } as never);
  assert.equal(oldHash, newHash);

  const normalized = normalizeMarkdown(
    '> Last generated: 2026\nlast_updated: "2026-07-11"\n# Heading\n',
  );
  assert.equal(normalized.trim(), "# Heading");
  assert.match(relativeCatalogPath(`${process.cwd()}/docs/platform/api-catalog.json`), /docs\/platform\/api-catalog\.json/);
});

test("generate-api-catalog dry-run prints json and writes nothing", async () => {
  const { generateApiCatalog } = await import("../scripts/generate-api-catalog");

  const writes: Array<{ path: string; content: string }> = [];
  const logs: string[] = [];

  generateApiCatalog(
    { dryRun: true, jsonOnly: false, mdOnly: false },
    {
      readFileSync: (() => "") as unknown as typeof import("node:fs").readFileSync,
      writeFileSync: ((path: string, content: string) => {
        writes.push({ path, content });
      }) as unknown as typeof import("node:fs").writeFileSync,
      buildCatalog: () => catalog as never,
      buildCatalogMarkdown: () => "# md",
      log: (...args: unknown[]) => logs.push(args.join(" ")),
    },
  );

  assert.equal(writes.length, 0);
  assert.match(logs[0] ?? "", /"routeCount": 2/);
});

test("generate-api-catalog skips unchanged outputs and writes changed artifacts", async () => {
  const { generateApiCatalog } = await import("../scripts/generate-api-catalog");

  const writes: Array<{ path: string; content: string }> = [];
  const logs: string[] = [];

  let readCount = 0;
  generateApiCatalog(
    { dryRun: false, jsonOnly: false, mdOnly: false },
    {
      readFileSync: ((path: string) => {
        readCount++;
        if (path.endsWith("api-catalog.json")) {
          return JSON.stringify({ ...catalog, generatedAt: "older" });
        }
        if (path.endsWith("api-catalog.md")) {
          return '> Last generated: old\nlast_updated: "old"\n# API';
        }
        return "";
      }) as unknown as typeof import("node:fs").readFileSync,
      writeFileSync: ((path: string, content: string) => {
        writes.push({ path, content });
      }) as unknown as typeof import("node:fs").writeFileSync,
      buildCatalog: () => catalog as never,
      buildCatalogMarkdown: () => '> Last generated: new\nlast_updated: "new"\n# API',
      log: (...args: unknown[]) => logs.push(args.join(" ")),
    },
  );

  assert.equal(readCount, 2);
  assert.equal(writes.length, 0);
  assert.match(logs.join("\n"), /is up to date/);

  logs.length = 0;
  generateApiCatalog(
    { dryRun: false, jsonOnly: false, mdOnly: false },
    {
      readFileSync: (() => {
        throw new Error("missing");
      }) as unknown as typeof import("node:fs").readFileSync,
      writeFileSync: ((path: string, content: string) => {
        writes.push({ path, content });
      }) as unknown as typeof import("node:fs").writeFileSync,
      buildCatalog: () => ({ ...catalog, routeCount: 3 }) as never,
      buildCatalogMarkdown: () => "# Fresh MD",
      log: (...args: unknown[]) => logs.push(args.join(" ")),
    },
  );

  assert.ok(writes.some((entry) => entry.path.endsWith("api-catalog.json")));
  assert.ok(writes.some((entry) => entry.path.endsWith("api-catalog.md")));
  assert.match(logs.join("\n"), /wrote docs\/platform\/api-catalog\.json/);
  assert.match(logs.join("\n"), /wrote docs\/platform\/api-catalog\.md/);
});

test("generate-api-catalog main returns zero", async () => {
  const { main } = await import("../scripts/generate-api-catalog");
  assert.equal(main(["--dry-run"]), 0);
});
