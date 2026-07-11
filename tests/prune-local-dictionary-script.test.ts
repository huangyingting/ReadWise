process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const fileMap = new Map<string, string>();
let writes: Array<{ path: string; content: string }> = [];

before(() => {
  mock.module("node:fs", {
    namedExports: {
      readFileSync: (path: string) => {
        const value = fileMap.get(path);
        if (value == null) throw new Error(`missing file ${path}`);
        return value;
      },
      writeFileSync: (path: string, content: string) => {
        writes.push({ path, content: String(content) });
      },
    },
  });

  mock.module("@/lib/lexical/normalize", {
    namedExports: {
      normalizeCandidates: (word: string) => {
        if (word.endsWith("s") && word.length > 1) return [word.slice(0, -1)];
        if (word === "am" || word === "is" || word === "are") return ["be"];
        return [];
      },
    },
  });
});

beforeEach(() => {
  writes = [];
  const en = {
    dog: ["", [["noun", ["an animal"]]]],
    dogs: ["", [["noun", ["plural of \"dog\""]]]],
    be: ["", [["verb", ["to exist"]]]],
    am: ["", [["verb", ["known irregular inflection"]]]],
    saw: ["", [["verb", ["past tense of \"see\""]]]],
  };
  const cn = {
    dog: ["", [["noun", ["an animal"]]]],
    dogs: ["", [["noun", ["dog inflection entry"]]]],
  };

  fileMap.clear();
  fileMap.set(`${process.cwd()}/dict/en-50k.json`, JSON.stringify(en));
  fileMap.set(`${process.cwd()}/dict/cn-50k.json`, JSON.stringify(cn));
});

test("prune dictionary helpers flatten text and derive base candidates", async () => {
  const { flattenText, extractQuotedBases, baseCandidates } = await import(
    "../scripts/prune-local-dictionary"
  );

  assert.match(flattenText({ a: "hello", b: ["world"] }), /hello/);
  assert.equal(flattenText(42), "42");
  assert.deepEqual(extractQuotedBases("plural of \"dog\" and from 'cat'"), ["dog", "cat"]);

  const bases = baseCandidates(
    "dogs",
    "plural of \"dog\"",
    new Set(["dog", "dogs"]),
  );
  assert.deepEqual(bases, ["dog"]);
});

test("prune dictionary removes inflections while keeping lexicalized entries", async () => {
  const { pruneDictionary } = await import("../scripts/prune-local-dictionary");

  const dictionary = {
    dog: ["", [["noun", ["animal"]]]],
    dogs: ["", [["noun", ["plural of \"dog\""]]]],
    saw: ["", [["verb", ["past tense of \"see\""]]]],
    be: ["", [["verb", ["to exist"]]]],
    am: ["", [["verb", ["first person singular"]]]],
  } as Record<string, [string, Array<[string, string[]]>]>;

  const result = pruneDictionary(dictionary);

  assert.ok(result.removed.some((entry) => entry.word === "dogs"));
  assert.ok(result.removed.some((entry) => entry.word === "am"));
  assert.ok(!result.removed.some((entry) => entry.word === "saw"));
  assert.ok(result.pruned.saw);
});

test("prune-local-dictionary main supports dry-run and write mode", async () => {
  const { main } = await import("../scripts/prune-local-dictionary");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/prune-local-dictionary.ts", "--dry-run"];
    main();
    assert.equal(writes.length, 0);
    assert.match(logs.join("\n"), /Dry run only/);

    const manyInflections = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [
        `dogs${index}`,
        ["", [["noun", ["plural of \"dog\""]]]],
      ]),
    );
    const largeDictionary = {
      dog: ["", [["noun", ["an animal"]]]],
      ...manyInflections,
    };
    fileMap.set(`${process.cwd()}/dict/en-50k.json`, JSON.stringify(largeDictionary));
    fileMap.set(`${process.cwd()}/dict/cn-50k.json`, JSON.stringify(largeDictionary));

    logs.length = 0;
    process.argv = [process.execPath, "scripts/prune-local-dictionary.ts"];
    main();
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.ok(writes.some((entry) => entry.path.endsWith("dict/en-50k.json")));
  assert.ok(writes.some((entry) => entry.path.endsWith("dict/cn-50k.json")));
  assert.ok(writes.some((entry) => entry.path.endsWith("dict/50k.txt")));
  assert.match(logs.join("\n"), /words after pruning/);
  assert.match(logs.join("\n"), /more/);
});

test("prune-local-dictionary entrypoint runs main when module is main", async () => {
  const scriptUrl = new URL("../scripts/prune-local-dictionary.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];

  process.argv = [process.execPath, scriptPath, "--dry-run"];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    const { runAsCli } = await import("../scripts/prune-local-dictionary");
    runAsCli(scriptUrl);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.match(logs.join("\n"), /Dry run only/);
});
