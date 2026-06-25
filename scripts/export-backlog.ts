/**
 * Refactoring backlog export (REF-071).
 *
 * Parses `docs/refactoring.md` and outputs each REF candidate as structured
 * JSON or CSV — suitable for spreadsheet / project-management import and for
 * seeding GitHub epics without re-running analysis.
 *
 * This script is read-only: it never contacts GitHub or any external service.
 *
 * Usage:
 *   # Dry-run (JSON to stdout):
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs \
 *     scripts/export-backlog.ts
 *
 *   # Write JSON file:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs \
 *     scripts/export-backlog.ts --format json --out backlog-export.json
 *
 *   # Write CSV file:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs \
 *     scripts/export-backlog.ts --format csv --out backlog-export.csv
 *
 *   # Filter by theme:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs \
 *     scripts/export-backlog.ts --theme ai
 *
 *   # Filter by priority:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs \
 *     scripts/export-backlog.ts --priority P0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKLOG_PATH = resolve(__dirname, "../docs/refactoring.md");

// ── Theme mapping (REF-NNN → theme) ────────────────────────────────────────

const THEME_MAP: Record<string, string> = {
  "REF-002": "platform",
  "REF-009": "platform",
  "REF-037": "platform",
  "REF-044": "platform",
  "REF-052": "platform",
  "REF-060": "platform",
  "REF-064": "platform",
  "REF-073": "platform",
  "REF-076": "platform",
  "REF-079": "platform",
  "REF-082": "platform",
  "REF-085": "platform",

  "REF-003": "api",
  "REF-014": "api",
  "REF-024": "api",
  "REF-042": "api",
  "REF-043": "api",
  "REF-070": "api",
  "REF-081": "api",

  "REF-022": "ai",
  "REF-023": "ai",
  "REF-026": "ai",
  "REF-027": "ai",
  "REF-041": "ai",
  "REF-047": "ai",
  "REF-067": "ai",

  "REF-004": "reader",
  "REF-005": "reader",
  "REF-029": "reader",
  "REF-030": "reader",
  "REF-050": "reader",
  "REF-055": "reader",
  "REF-062": "reader",

  "REF-006": "learning",
  "REF-028": "learning",
  "REF-045": "learning",
  "REF-046": "learning",
  "REF-048": "learning",
  "REF-051": "learning",

  "REF-010": "content-ingestion",
  "REF-016": "content-ingestion",
  "REF-017": "content-ingestion",
  "REF-025": "content-ingestion",
  "REF-031": "content-ingestion",
  "REF-038": "content-ingestion",
  "REF-040": "content-ingestion",
  "REF-072": "content-ingestion",

  "REF-019": "data-schema",
  "REF-039": "data-schema",
  "REF-049": "data-schema",
  "REF-069": "data-schema",

  "REF-015": "observability",
  "REF-018": "observability",
  "REF-053": "observability",

  "REF-001": "frontend",
  "REF-007": "frontend",
  "REF-011": "frontend",
  "REF-012": "frontend",
  "REF-021": "frontend",
  "REF-032": "frontend",
  "REF-054": "frontend",
  "REF-057": "frontend",
  "REF-058": "frontend",
  "REF-059": "frontend",
  "REF-063": "frontend",
  "REF-068": "frontend",
  "REF-074": "frontend",
  "REF-075": "frontend",
  "REF-077": "frontend",
  "REF-078": "frontend",
  "REF-080": "frontend",
  "REF-083": "frontend",
  "REF-084": "frontend",

  "REF-013": "tests",
  "REF-033": "tests",
  "REF-065": "tests",
  "REF-086": "tests",

  "REF-008": "operations",
  "REF-020": "operations",
  "REF-034": "operations",
  "REF-035": "operations",
  "REF-036": "operations",
  "REF-056": "operations",
  "REF-061": "operations",
  "REF-066": "operations",

  "REF-071": "planning",
};

// ── Types ───────────────────────────────────────────────────────────────────

type BacklogEntry = {
  id: string;
  title: string;
  priority: string;
  area: string;
  theme: string;
  status: string;
  anchor: string;
};

// ── Parser ──────────────────────────────────────────────────────────────────

function parseBacklog(source: string): BacklogEntry[] {
  const entries: BacklogEntry[] = [];
  const lines = source.split("\n");

  const headingRe = /^### (REF-\d+) — (.+)$/;
  const priorityRe = /^Priority:\s*(P\d+)\.\s*Area:\s*(.+?)\.?\s*$/;
  const statusRe = /^Status:\s*(.+)/;

  let i = 0;
  while (i < lines.length) {
    const headingMatch = headingRe.exec(lines[i]);
    if (!headingMatch) {
      i++;
      continue;
    }

    const id = headingMatch[1];
    const title = headingMatch[2].trim();
    const anchor = `${id.toLowerCase()}-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}`;

    let priority = "";
    let area = "";
    let status = "open";

    // Scan the next ~5 lines for Priority/Status
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const pm = priorityRe.exec(lines[j]);
      if (pm) {
        priority = pm[1];
        area = pm[2].trim();
      }
      const sm = statusRe.exec(lines[j]);
      if (sm) {
        const raw = sm[1].trim().toLowerCase();
        if (raw.startsWith("resolved")) status = "resolved";
        else if (raw.startsWith("in progress")) status = "in-progress";
        else if (raw.startsWith("superseded")) status = "superseded";
        else if (raw.startsWith("deferred")) status = "deferred";
      }
      // Stop at the next heading
      if (lines[j].startsWith("###") && j !== i) break;
    }

    entries.push({
      id,
      title,
      priority,
      area,
      theme: THEME_MAP[id] ?? "unknown",
      status,
      anchor,
    });

    i++;
  }

  return entries;
}

// ── Formatters ──────────────────────────────────────────────────────────────

function toJson(entries: BacklogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(entries: BacklogEntry[]): string {
  const headers = ["id", "title", "priority", "theme", "area", "status", "anchor"];
  const rows = [
    headers.join(","),
    ...entries.map((e) =>
      headers.map((h) => csvEscape(String(e[h as keyof BacklogEntry]))).join(",")
    ),
  ];
  return rows.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

type Args = {
  format: "json" | "csv";
  out: string | null;
  theme: string | null;
  priority: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { format: "json", out: null, theme: null, priority: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--format" && argv[i + 1]) {
      const f = argv[++i];
      if (f !== "json" && f !== "csv") {
        console.error(`Unknown format: ${f}. Use "json" or "csv".`);
        process.exit(1);
      }
      args.format = f;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      args.out = argv[++i];
    } else if (argv[i] === "--theme" && argv[i + 1]) {
      args.theme = argv[++i];
    } else if (argv[i] === "--priority" && argv[i + 1]) {
      args.priority = argv[++i].toUpperCase();
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const source = readFileSync(BACKLOG_PATH, "utf8");
  let entries = parseBacklog(source);

  if (args.theme) {
    entries = entries.filter((e) => e.theme === args.theme);
    if (entries.length === 0) {
      console.error(
        `No entries found for theme "${args.theme}". Valid themes: ${[...new Set(Object.values(THEME_MAP))].sort().join(", ")}`
      );
      process.exit(1);
    }
  }

  if (args.priority) {
    entries = entries.filter((e) => e.priority === args.priority);
    if (entries.length === 0) {
      console.error(
        `No entries found for priority "${args.priority}". Valid values: P0, P1, P2, P3.`
      );
      process.exit(1);
    }
  }

  const output = args.format === "csv" ? toCsv(entries) : toJson(entries);

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    writeFileSync(outPath, output, "utf8");
    console.log(
      `Wrote ${entries.length} entries (${args.format.toUpperCase()}) → ${outPath}`
    );
  } else {
    console.log(output);
  }
}

main();
