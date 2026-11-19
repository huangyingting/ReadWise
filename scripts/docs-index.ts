/**
 * Documentation index generator and structure check.
 *
 * Keeps `docs/` maintainable as it grows by generating the indexes from the
 * documents themselves and enforcing the contract in
 * `docs/platform/documentation-governance.md`:
 *
 *   - `docs/README.md` gets a generated table of subsystems (one row per
 *     `docs/<subsystem>/README.md`, using that README's description);
 *   - each `docs/<subsystem>/README.md` gets a generated table of its documents
 *     (title, type, status, description — all read from each file).
 *
 * Generated tables live between BEGIN/END GENERATED markers; everything outside
 * the markers is hand-written. `--check` also validates frontmatter, the flat
 * layout, titles, and relative links.
 *
 * Usage (from repo root):
 *   npm run docs:index   # rewrite generated tables
 *   npm run docs:check   # fail on stale tables or structure problems
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, runScript } from "./lib/cli";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = "docs";

export const DOC_TYPES = [
  "architecture",
  "catalog",
  "design",
  "index",
  "plan",
  "policy",
  "reference",
  "runbook",
  "template",
  "testing",
] as const;
export const DOC_STATUSES = ["current", "accepted", "generated", "proposed", "template"] as const;
export const MAX_DESCRIPTION_LENGTH = 300;
const FRONTMATTER_KEYS = ["type", "status", "last_updated", "description"] as const;
/** Non-Markdown artifacts allowed in a subsystem directory (each must be linked from its README). */
const ARTIFACT_EXTENSIONS = [".json", ".csv"];

const BEGIN_MARKER = "<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->";
const END_MARKER = "<!-- END GENERATED: docs-index -->";

export type Frontmatter = Record<string, string>;

/** The docs tree as repo-relative paths (`docs/...`) mapped to file contents (Markdown only). */
export type DocsTree = {
  /** Subsystem directory names directly under `docs/`. */
  subsystems: string[];
  /** Markdown files: path → content. */
  markdown: Map<string, string>;
  /** Every file path under `docs/` (Markdown and artifacts). */
  files: string[];
  /** Directories nested inside a subsystem directory (must be empty for a flat layout). */
  nestedDirs: string[];
};

// ── Parsing ────────────────────────────────────────────────────────────────

/** Parses the leading `---` YAML frontmatter (flat `key: "value"` pairs); null when absent. */
export function parseFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fields: Frontmatter = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (!pair) continue;
    const raw = (pair[2] ?? "").trim();
    fields[pair[1] ?? ""] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return fields;
}

/** The first `# ` heading, or null. */
export function documentTitle(content: string): string | null {
  const match = stripCode(content).match(/^# (.+)$/m);
  return match ? (match[1] ?? "").trim() : null;
}

function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Relative link targets (no URLs, mailto, or pure anchors), with any `#anchor` removed. */
export function relativeLinks(content: string): string[] {
  const targets: string[] = [];
  for (const match of stripCode(content).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? "";
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    const path = target.split("#")[0] ?? "";
    if (path) targets.push(path);
  }
  return targets;
}

// ── Rendering ──────────────────────────────────────────────────────────────

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function subsystemReadmePath(subsystem: string): string {
  return posix.join(DOCS_DIR, subsystem, "README.md");
}

/** Markdown documents in a subsystem, excluding its README, sorted by filename. */
function subsystemDocs(tree: DocsTree, subsystem: string): string[] {
  const prefix = `${DOCS_DIR}/${subsystem}/`;
  return [...tree.markdown.keys()]
    .filter((path) => path.startsWith(prefix) && path !== `${prefix}README.md`)
    .sort();
}

/** The generated document table for one subsystem README. */
export function renderSubsystemIndex(tree: DocsTree, subsystem: string): string {
  const rows = subsystemDocs(tree, subsystem).map((path) => {
    const content = tree.markdown.get(path) ?? "";
    const fm = parseFrontmatter(content) ?? {};
    const file = posix.basename(path);
    const title = documentTitle(content) ?? file;
    return `| [${escapeCell(title)}](./${file}) | ${fm.type ?? ""} | ${fm.status ?? ""} | ${escapeCell(fm.description ?? "")} |`;
  });
  return ["| Document | Type | Status | Description |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** The generated subsystem table for `docs/README.md`. */
export function renderRootIndex(tree: DocsTree): string {
  const rows = [...tree.subsystems].sort().map((subsystem) => {
    const readme = tree.markdown.get(subsystemReadmePath(subsystem)) ?? "";
    const title = documentTitle(readme) ?? subsystem;
    const description = parseFrontmatter(readme)?.description ?? "";
    const count = subsystemDocs(tree, subsystem).length;
    return `| [${escapeCell(title)}](./${subsystem}/README.md) | ${escapeCell(description)} | ${count} |`;
  });
  return ["| Subsystem | Scope | Docs |", "| --- | --- | --- |", ...rows].join("\n");
}

/** Replaces the generated block in `content`; null when the markers are missing. */
export function replaceGeneratedBlock(content: string, body: string): string | null {
  const start = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return null;
  return `${content.slice(0, start)}${BEGIN_MARKER}\n\n${body}\n\n${content.slice(end)}`;
}

/** Every index file with its regenerated content (or null when its markers are missing). */
export function generateIndexes(tree: DocsTree): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const rootPath = posix.join(DOCS_DIR, "README.md");
  out.set(rootPath, replaceGeneratedBlock(tree.markdown.get(rootPath) ?? "", renderRootIndex(tree)));
  for (const subsystem of tree.subsystems) {
    const path = subsystemReadmePath(subsystem);
    const content = tree.markdown.get(path);
    if (content !== undefined) {
      out.set(path, replaceGeneratedBlock(content, renderSubsystemIndex(tree, subsystem)));
    }
  }
  return out;
}

// ── Validation ─────────────────────────────────────────────────────────────

function frontmatterProblems(path: string, content: string): string[] {
  const fm = parseFrontmatter(content);
  if (!fm) return [`${path}: missing YAML frontmatter`];
  const problems: string[] = [];
  for (const key of FRONTMATTER_KEYS) {
    if (!fm[key]) problems.push(`${path}: frontmatter is missing "${key}"`);
  }
  for (const key of Object.keys(fm)) {
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      problems.push(`${path}: unexpected frontmatter field "${key}"`);
    }
  }
  if (fm.type && !(DOC_TYPES as readonly string[]).includes(fm.type)) {
    problems.push(`${path}: unknown type "${fm.type}" (expected one of ${DOC_TYPES.join(", ")})`);
  }
  if (fm.status && !(DOC_STATUSES as readonly string[]).includes(fm.status)) {
    problems.push(`${path}: unknown status "${fm.status}" (expected one of ${DOC_STATUSES.join(", ")})`);
  }
  if (fm.last_updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.last_updated)) {
    problems.push(`${path}: last_updated must be YYYY-MM-DD`);
  }
  if (fm.description && fm.description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(
      `${path}: description is ${fm.description.length} characters (max ${MAX_DESCRIPTION_LENGTH}); move detail into the body`,
    );
  }
  return problems;
}

/**
 * Structure problems in the docs tree. `exists` resolves repo-relative paths
 * (link targets may point outside `docs/`, e.g. to `src/` or the root README).
 */
export function validateDocs(tree: DocsTree, exists: (repoPath: string) => boolean): string[] {
  const problems: string[] = [];

  for (const path of tree.files) {
    const depth = path.split("/").length;
    if (depth === 2 && path !== `${DOCS_DIR}/README.md`) {
      problems.push(`${path}: only README.md may live at the docs root; move it into a docs/<subsystem>/ directory`);
    }
    if (depth === 3 && !path.endsWith(".md") && !ARTIFACT_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      problems.push(`${path}: unexpected file type in docs/`);
    }
  }
  for (const dir of tree.nestedDirs) {
    problems.push(`${dir}: subsystem directories must stay flat (no nested folders)`);
  }
  for (const subsystem of tree.subsystems) {
    const readme = tree.markdown.get(subsystemReadmePath(subsystem));
    if (readme === undefined) {
      problems.push(`docs/${subsystem}: missing README.md subsystem index`);
    } else if (parseFrontmatter(readme)?.type !== "index") {
      problems.push(`${subsystemReadmePath(subsystem)}: subsystem README must have type "index"`);
    }
  }

  for (const [path, content] of tree.markdown) {
    problems.push(...frontmatterProblems(path, content));
    if (!documentTitle(content)) problems.push(`${path}: missing a "# " title`);
    for (const target of relativeLinks(content)) {
      const resolved = normalize(join(posix.dirname(path), target));
      if (!exists(resolved)) problems.push(`${path}: broken link to ${target}`);
    }
  }

  for (const artifact of tree.files.filter((path) => !path.endsWith(".md"))) {
    const subsystem = artifact.split("/")[1] ?? "";
    const readme = tree.markdown.get(subsystemReadmePath(subsystem)) ?? "";
    if (!relativeLinks(readme).includes(`./${posix.basename(artifact)}`)) {
      problems.push(`${artifact}: artifacts must be linked from docs/${subsystem}/README.md`);
    }
  }

  for (const [path, generated] of generateIndexes(tree)) {
    if (generated === null) {
      problems.push(`${path}: missing the generated docs-index markers`);
    } else if (generated !== tree.markdown.get(path)) {
      problems.push(`${path}: generated index is stale; run npm run docs:index`);
    }
  }

  return problems;
}

// ── Filesystem ─────────────────────────────────────────────────────────────

type FsDeps = {
  readdirSync: (path: string) => string[];
  isDirectory: (path: string) => boolean;
  readFileSync: (path: string) => string;
};

const defaultFsDeps: FsDeps = {
  readdirSync: (path) => readdirSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  readFileSync: (path) => readFileSync(path, "utf8"),
};

/** Reads `docs/` under `root` into a {@link DocsTree}. */
export function loadDocsTree(root: string = ROOT, fs: FsDeps = defaultFsDeps): DocsTree {
  const tree: DocsTree = { subsystems: [], markdown: new Map(), files: [], nestedDirs: [] };
  const addFile = (repoPath: string) => {
    tree.files.push(repoPath);
    if (repoPath.endsWith(".md")) tree.markdown.set(repoPath, fs.readFileSync(join(root, repoPath)));
  };
  for (const entry of fs.readdirSync(join(root, DOCS_DIR)).sort()) {
    const repoPath = posix.join(DOCS_DIR, entry);
    if (!fs.isDirectory(join(root, repoPath))) {
      addFile(repoPath);
      continue;
    }
    tree.subsystems.push(entry);
    for (const child of fs.readdirSync(join(root, repoPath)).sort()) {
      const childPath = posix.join(repoPath, child);
      if (fs.isDirectory(join(root, childPath))) tree.nestedDirs.push(childPath);
      else addFile(childPath);
    }
  }
  return tree;
}

type MainDeps = {
  root: string;
  fs: FsDeps;
  exists: (absolutePath: string) => boolean;
  writeFileSync: (path: string, content: string) => void;
  log: (message: string) => void;
  error: (message: string) => void;
};

const defaultMainDeps: MainDeps = {
  root: ROOT,
  fs: defaultFsDeps,
  exists: existsSync,
  writeFileSync: (path, content) => writeFileSync(path, content),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/** `--check` reports problems (exit 1); otherwise rewrites stale generated tables first. */
export function main(argv: string[] = process.argv.slice(2), deps: MainDeps = defaultMainDeps): number {
  const check = argv.includes("--check");
  let tree = loadDocsTree(deps.root, deps.fs);

  if (!check) {
    for (const [path, generated] of generateIndexes(tree)) {
      if (generated !== null && generated !== tree.markdown.get(path)) {
        deps.writeFileSync(join(deps.root, path), generated);
        deps.log(`✓ updated ${path}`);
      }
    }
    tree = loadDocsTree(deps.root, deps.fs);
  }

  const problems = validateDocs(tree, (repoPath) => deps.exists(join(deps.root, repoPath)));
  for (const problem of problems) deps.error(`✗ ${problem}`);
  if (problems.length > 0) return 1;
  deps.log(`✓ docs structure OK (${tree.markdown.size} Markdown files in ${tree.subsystems.length} subsystems)`);
  return 0;
}

if (isMain(import.meta.url)) {
  runScript(async () => main(), "docs-index failed");
}
