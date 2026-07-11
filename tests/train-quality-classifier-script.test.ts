process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

let writes: Array<{ path: string; content: string }> = [];

before(() => {
  mock.module("node:fs", {
    namedExports: {
      writeFileSync: (path: string, content: string) => {
        writes.push({ path, content: String(content) });
      },
    },
  });

  mock.module("@/lib/scraper/quality-classifier-corpus", {
    namedExports: {
      ARTICLE_SAMPLES: [
        "Article prose sample one with enough content words for classifier training.",
        "Article prose sample two with coherent writing style and detail.",
      ],
      AD_SAMPLES: [
        "Ad copy sample one with promotional language and urgency.",
        "Ad copy sample two offering discounts and calls to action.",
      ],
    },
  });
});

beforeEach(() => {
  writes = [];
});

test("train-quality-classifier trainClassifier uses provided Natural constructor", async () => {
  const { trainClassifier } = await import("../scripts/train-quality-classifier");

  const added: Array<{ text: string; label: string }> = [];
  let trained = false;
  class FakeClassifier {
    addDocument(text: string, label: string) {
      added.push({ text, label });
    }
    train() {
      trained = true;
    }
  }

  const classifier = trainClassifier({ BayesClassifier: FakeClassifier as never });
  assert.ok(classifier);
  assert.equal(added.length, 4);
  assert.equal(trained, true);
  assert.deepEqual(added.map((entry) => entry.label), ["article", "article", "ad", "ad"]);
});

test("train-quality-classifier resolves output path and writes serialized model", async () => {
  const { resolveOutputPath, main } = await import("../scripts/train-quality-classifier");

  assert.match(resolveOutputPath(), /src\/lib\/scraper\/quality-classifier-model\.json$/);

  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    main();
  } finally {
    console.log = originalLog;
  }

  assert.equal(writes.length, 1);
  assert.match(writes[0]?.path ?? "", /quality-classifier-model\.json$/);
  assert.match(writes[0]?.content ?? "", /^\{[\s\S]+\}\n$/);
  assert.match(logs.join("\n"), /Trained quality classifier:/);
});

test("train-quality-classifier entrypoint runs main when module is main", async () => {
  const scriptUrl = new URL("../scripts/train-quality-classifier.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];

  process.argv = [process.execPath, scriptPath];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    const { runAsCli } = await import("../scripts/train-quality-classifier");
    runAsCli(scriptUrl);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }

  assert.match(logs.join("\n"), /Trained quality classifier:/);
});
