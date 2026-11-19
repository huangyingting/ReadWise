import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  documentTitle,
  generateIndexes,
  loadDocsTree,
  main,
  parseFrontmatter,
  relativeLinks,
  renderRootIndex,
  renderSubsystemIndex,
  replaceGeneratedBlock,
  validateDocs,
  type DocsTree,
} from "../scripts/docs-index";

const BEGIN = "<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->";
const END = "<!-- END GENERATED: docs-index -->";

function doc(fields: Record<string, string>, body: string): string {
  const fm = Object.entries(fields)
    .map(([key, value]) => `${key}: "${value}"`)
    .join("\n");
  return `---\n${fm}\n---\n\n${body}\n`;
}

const fm = (type: string, description: string) => ({
  type,
  status: "current",
  last_updated: "2026-11-19",
  description,
});

/** A small valid tree: one subsystem with one topic doc and a linked artifact. */
function fixture(): DocsTree {
  const markdown = new Map<string, string>([
    ["docs/README.md", doc(fm("index", "Root index."), `# Docs\n\n${BEGIN}\n\n${END}\n`)],
    [
      "docs/reader/README.md",
      doc(fm("index", "Reading | experience."), `# Reader\n\nSee [data](./data.json).\n\n${BEGIN}\n\n${END}\n`),
    ],
    ["docs/reader/notes.md", doc(fm("reference", "Notes and highlights."), "# Notes\n\nBack to [index](./README.md#top).")],
  ]);
  const tree: DocsTree = {
    subsystems: ["reader"],
    markdown,
    files: ["docs/README.md", "docs/reader/README.md", "docs/reader/data.json", "docs/reader/notes.md"],
    nestedDirs: [],
  };
  for (const [path, content] of generateIndexes(tree)) markdown.set(path, content ?? "");
  return tree;
}

const allExist = () => true;

test("the repository docs tree satisfies the documentation contract", () => {
  const root = join(import.meta.dirname, "..");
  const problems = validateDocs(loadDocsTree(root), (repoPath) => existsSync(join(root, repoPath)));
  assert.deepEqual(problems, [], `Run npm run docs:index / docs:check:\n${problems.join("\n")}`);
});

test("parseFrontmatter reads quoted and bare values and returns null without frontmatter", () => {
  assert.deepEqual(parseFrontmatter('---\ntype: "index"\nstatus: current\nnot a pair\n---\n# T\n'), {
    type: "index",
    status: "current",
  });
  assert.equal(parseFrontmatter("# No frontmatter\n"), null);
});

test("documentTitle ignores headings inside code blocks", () => {
  assert.equal(documentTitle("```\n# not this\n```\n# Real title\n"), "Real title");
  assert.equal(documentTitle("no heading"), null);
});

test("relativeLinks skips URLs, anchors, and code, and strips fragments", () => {
  const links = relativeLinks(
    '[a](./a.md) [b](https://x.test) [c](#top) [d](../d.md#sec "t") `[e](./e.md)` [f](mailto:x@y.z)\n```\n[g](./g.md)\n```',
  );
  assert.deepEqual(links, ["./a.md", "../d.md"]);
});

test("renderers build escaped tables from frontmatter, titles, and doc counts", () => {
  const tree = fixture();
  assert.match(renderRootIndex(tree), /\| \[Reader\]\(\.\/reader\/README\.md\) \| Reading \\\| experience\. \| 1 \|/);
  assert.match(renderSubsystemIndex(tree, "reader"), /\| \[Notes\]\(\.\/notes\.md\) \| reference \| current \| Notes and highlights\. \|/);
});

test("renderers fall back to file and directory names when titles are missing", () => {
  const tree: DocsTree = {
    subsystems: ["misc"],
    markdown: new Map([
      ["docs/README.md", ""],
      ["docs/misc/README.md", "no frontmatter"],
      ["docs/misc/untitled.md", "plain text"],
    ]),
    files: [],
    nestedDirs: [],
  };
  assert.match(renderRootIndex(tree), /\[misc\]\(\.\/misc\/README\.md\) \|  \| 1 \|/);
  assert.match(renderSubsystemIndex(tree, "misc"), /\[untitled\.md\]\(\.\/untitled\.md\) \|  \|  \|  \|/);
});

test("replaceGeneratedBlock needs both markers in order", () => {
  assert.equal(replaceGeneratedBlock(`a\n${BEGIN}\nold\n${END}\nb`, "new"), `a\n${BEGIN}\n\nnew\n\n${END}\nb`);
  assert.equal(replaceGeneratedBlock("no markers", "x"), null);
  assert.equal(replaceGeneratedBlock(`${END}\n${BEGIN}`, "x"), null);
});

test("a generated fixture validates cleanly", () => {
  assert.deepEqual(validateDocs(fixture(), allExist), []);
});

test("validateDocs reports layout, frontmatter, title, link, artifact, and freshness problems", () => {
  const tree = fixture();
  tree.files.push("docs/loose.md", "docs/reader/image.png", "docs/reader/orphan.csv");
  tree.nestedDirs.push("docs/reader/nested");
  tree.subsystems.push("empty", "badindex");
  tree.markdown.set("docs/badindex/README.md", doc(fm("reference", "Not an index."), `# Bad\n\n${BEGIN}\n\n${END}\n`));
  tree.markdown.set("docs/loose.md", "# Loose\n");
  tree.markdown.set(
    "docs/reader/bad.md",
    doc(
      { type: "memo", status: "draft", last_updated: "19-11-2026", description: "x".repeat(301), extra: "y" },
      "no title [gone](./gone.md)",
    ),
  );
  tree.markdown.set("docs/reader/partial.md", '---\ntype: "reference"\n---\n# Partial\n');

  const problems = validateDocs(tree, (path) => !path.endsWith("gone.md")).join("\n");
  for (const expected of [
    "docs/loose.md: only README.md may live at the docs root",
    "docs/loose.md: missing YAML frontmatter",
    "docs/reader/image.png: unexpected file type",
    "docs/reader/nested: subsystem directories must stay flat",
    "docs/empty: missing README.md subsystem index",
    'docs/badindex/README.md: subsystem README must have type "index"',
    'docs/reader/bad.md: unknown type "memo"',
    'docs/reader/bad.md: unknown status "draft"',
    "docs/reader/bad.md: last_updated must be YYYY-MM-DD",
    "docs/reader/bad.md: description is 301 characters",
    'docs/reader/bad.md: unexpected frontmatter field "extra"',
    'docs/reader/bad.md: missing a "# " title',
    "docs/reader/bad.md: broken link to ./gone.md",
    'docs/reader/partial.md: frontmatter is missing "status"',
    "docs/reader/orphan.csv: artifacts must be linked from docs/reader/README.md",
    "docs/reader/README.md: generated index is stale",
  ]) {
    assert.ok(problems.includes(expected), `expected problem: ${expected}\n---\n${problems}`);
  }

  tree.markdown.set("docs/README.md", "# Root without markers\n");
  assert.match(validateDocs(tree, allExist).join("\n"), /docs\/README\.md: missing the generated docs-index markers/);
});

/** An in-memory filesystem rooted at `/repo` for loadDocsTree / main. */
function fakeFs(files: Record<string, string>, dirs: string[]) {
  const dirSet = new Set(dirs.map((dir) => `/repo/${dir}`));
  const contents = new Map(Object.entries(files).map(([path, content]) => [`/repo/${path}`, content]));
  return {
    contents,
    fs: {
      readdirSync: (path: string) =>
        [...new Set([...contents.keys(), ...dirSet])]
          .filter((entry) => entry.startsWith(`${path}/`) && !entry.slice(path.length + 1).includes("/"))
          .map((entry) => entry.slice(path.length + 1)),
      isDirectory: (path: string) => dirSet.has(path),
      readFileSync: (path: string) => contents.get(path) ?? "",
    },
  };
}

test("loadDocsTree reads root files, subsystems, artifacts, and nested directories", () => {
  const { fs } = fakeFs(
    { "docs/README.md": "# Root", "docs/reader/notes.md": "# N", "docs/reader/data.json": "{}" },
    ["docs", "docs/reader", "docs/reader/deep"],
  );
  const tree = loadDocsTree("/repo", fs);
  assert.deepEqual(tree.subsystems, ["reader"]);
  assert.deepEqual(tree.nestedDirs, ["docs/reader/deep"]);
  assert.deepEqual(tree.files.sort(), ["docs/README.md", "docs/reader/data.json", "docs/reader/notes.md"]);
  assert.equal(tree.markdown.get("docs/reader/notes.md"), "# N");
  assert.equal(tree.markdown.has("docs/reader/data.json"), false);
});

function mainDeps(files: Record<string, string>) {
  const { fs, contents } = fakeFs(files, ["docs", "docs/reader"]);
  const logs: string[] = [];
  const errors: string[] = [];
  const writes: string[] = [];
  return {
    logs,
    errors,
    writes,
    deps: {
      root: "/repo",
      fs,
      exists: (path: string) => contents.has(path) || path === "/repo/docs/reader/README.md",
      writeFileSync: (path: string, content: string) => {
        writes.push(path);
        contents.set(path, content);
      },
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

const staleFiles = () => ({
  "docs/README.md": doc(fm("index", "Root."), `# Docs\n\n${BEGIN}\n\n${END}\n`),
  "docs/reader/README.md": doc(fm("index", "Reader."), `# Reader\n\n${BEGIN}\n\n${END}\n`),
  "docs/reader/notes.md": doc(fm("reference", "Notes."), "# Notes"),
});

test("main --check reports stale indexes without writing", () => {
  const run = mainDeps(staleFiles());
  assert.equal(main(["--check"], run.deps), 1);
  assert.deepEqual(run.writes, []);
  assert.ok(run.errors.some((line) => line.includes("generated index is stale")));
});

test("main rewrites stale indexes and then passes", () => {
  const run = mainDeps(staleFiles());
  assert.equal(main([], run.deps), 0);
  assert.deepEqual(run.writes.sort(), ["/repo/docs/README.md", "/repo/docs/reader/README.md"]);
  assert.match(run.logs.at(-1) ?? "", /docs structure OK \(3 Markdown files in 1 subsystems\)/);

  // Idempotent: a second run over the rewritten files changes nothing.
  run.writes.length = 0;
  assert.equal(main([], run.deps), 0);
  assert.deepEqual(run.writes, []);
});
