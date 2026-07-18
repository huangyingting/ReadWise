process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

let baseSchema = 'datasource db {\n  provider = "{{PROVIDER}}"\n}\n';
let writes: Array<{ path: string; content: string }> = [];

before(() => {
  mock.module("node:fs/promises", {
    namedExports: {
      readFile: async () => baseSchema,
      readdir: async () => [],
      writeFile: async (path: string, content: string) => {
        writes.push({ path, content: String(content) });
      },
    },
  });
});

beforeEach(() => {
  baseSchema = 'datasource db {\n  provider = "{{PROVIDER}}"\n}\n';
  writes = [];
});

test("generate-schemas writes SQLite and PostgreSQL outputs", async () => {
  const { generateSchemas } = await import("../scripts/generate-schemas");

  await generateSchemas();

  assert.equal(writes.length, 2);
  assert.ok(writes.some((entry) => entry.path === "prisma/schema.prisma" && entry.content.includes('provider = "sqlite"')));
  assert.ok(
    writes.some(
      (entry) =>
        entry.path === "prisma/postgresql/schema.prisma" && entry.content.includes('provider = "postgresql"'),
    ),
  );
});

test("generate-schemas fails when base schema omits provider placeholder", async () => {
  const { generateSchemas } = await import("../scripts/generate-schemas");
  baseSchema = 'datasource db {\n  provider = "sqlite"\n}\n';

  await assert.rejects(() => generateSchemas(), /must contain the placeholder/);
});

test("generate-schemas main logs completion guidance", async () => {
  const { main } = await import("../scripts/generate-schemas");

  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;
  try {
    await main();
  } finally {
    console.log = originalLog;
  }

  assert.match(logs.join("\n"), /Schema generation complete/);
  assert.match(logs.join("\n"), /git diff -- prisma\/schema\.prisma/);
});

test("generate-schemas entrypoint executes runScript when module is main", async () => {
  const scriptUrl = new URL("../scripts/generate-schemas.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const exits: Array<number | undefined> = [];

  let resolveExit: (() => void) | null = null;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  process.argv = [process.execPath, scriptPath];
  process.exit = ((code?: string | number | null | undefined): never => {
    exits.push(typeof code === "number" ? code : code == null ? 0 : Number(code));
    resolveExit?.();
    return undefined as never;
  }) as typeof process.exit;
  console.log = (() => undefined) as typeof console.log;
  console.error = (() => undefined) as typeof console.error;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { runAsCli } = await import("../scripts/generate-schemas");
    runAsCli(scriptUrl);
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("generate-schemas entrypoint did not exit")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
});
