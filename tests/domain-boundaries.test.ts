import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMPORT_RE =
  /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(absolute));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function importsFor(file: string): string[] {
  const content = fs.readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    specs.push(match[1]);
  }
  return specs;
}

test("non-admin lib modules do not import the admin domain", () => {
  const libFiles = walkTs(path.join(ROOT, "src/lib")).filter(
    (file) => !rel(file).startsWith("src/lib/admin/"),
  );
  const violations: string[] = [];

  for (const file of libFiles) {
    const offender = importsFor(file).find(
      (spec) => spec === "@/lib/admin" || spec.startsWith("@/lib/admin/"),
    );
    if (offender) violations.push(`${rel(file)} -> ${offender}`);
  }

  assert.deepEqual(violations, []);
});

test("analytics and metrics remain structurally separate", () => {
  const analyticsFiles = walkTs(path.join(ROOT, "src/lib/analytics"));
  const metricsFiles = walkTs(path.join(ROOT, "src/lib/metrics"));
  const violations: string[] = [];

  for (const file of analyticsFiles) {
    const offender = importsFor(file).find((spec) =>
      spec === "@/lib/metrics" || spec.startsWith("@/lib/metrics/"));
    if (offender) violations.push(`${rel(file)} -> ${offender}`);
  }

  for (const file of metricsFiles) {
    const offender = importsFor(file).find((spec) =>
      spec === "@/lib/analytics" || spec.startsWith("@/lib/analytics/"));
    if (offender) violations.push(`${rel(file)} -> ${offender}`);
  }

  assert.deepEqual(violations, []);
});

test("analytics internals avoid barrel back-imports", () => {
  const analyticsFiles = walkTs(path.join(ROOT, "src/lib/analytics")).filter(
    (file) => path.basename(file) !== "index.ts",
  );
  const violations: string[] = [];

  for (const file of analyticsFiles) {
    const offender = importsFor(file).find((spec) =>
      spec === "@/lib/analytics" ||
      spec === "@/lib/analytics/events" ||
      spec === "@/lib/analytics/queries");
    if (offender) violations.push(`${rel(file)} -> ${offender}`);
  }

  assert.deepEqual(violations, []);
});

test("domain public barrels still expose key API symbols", () => {
  const checks: Array<{ file: string; symbols: string[] }> = [
    {
      file: "src/lib/classroom/index.ts",
      symbols: [
        "canCreateClassroom",
        "canManageClassroom",
        "getClassroom",
        "createClassroom",
        "recordAssignmentCompletion",
        "listAssignmentsForStudent",
        "getClassroomProgressData",
      ],
    },
    {
      file: "src/lib/org/index.ts",
      symbols: [
        "slugifyOrg",
        "hasOrgCapability",
        "isSystemAdmin",
        "requireOrgAdmin",
        "getMembership",
        "createOrganization",
      ],
    },
    {
      file: "src/lib/metrics/index.ts",
      symbols: [
        "getMetricsSnapshot",
        "exportMetricsPrometheus",
        "recordApiRequest",
        "recordDbQuery",
        "recordJobQueueEvent",
      ],
    },
  ];

  for (const check of checks) {
    const content = fs.readFileSync(path.join(ROOT, check.file), "utf8");
    for (const symbol of check.symbols) {
      assert.match(content, new RegExp(`\\b${symbol}\\b`), `${check.file} missing ${symbol}`);
    }
  }
});
