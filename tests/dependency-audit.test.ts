import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateDependencyAudits,
  type AuditReport,
  type PackageLock,
} from "../scripts/audit-dependencies";

const ADVISORY_URL = "https://github.com/advisories/GHSA-mh99-v99m-4gvg";

function cleanReport(): AuditReport {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  };
}

function braceExpansionReport(): AuditReport {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "brace-expansion": {
        name: "brace-expansion",
        severity: "high",
        via: [
          {
            source: 1124334,
            name: "brace-expansion",
            url: ADVISORY_URL,
            severity: "high",
          },
        ],
        nodes: ["node_modules/eslint/node_modules/brace-expansion"],
      },
      minimatch: {
        name: "minimatch",
        severity: "high",
        via: ["brace-expansion"],
        nodes: ["node_modules/eslint/node_modules/minimatch"],
      },
      eslint: {
        name: "eslint",
        severity: "high",
        via: ["minimatch"],
        nodes: ["node_modules/eslint"],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 3,
        critical: 0,
        total: 3,
      },
    },
  };
}

function patchedLockfile(): PackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      "node_modules/eslint/node_modules/brace-expansion": {
        version: "1.1.18",
        dev: true,
      },
    },
  };
}

test("dependency audit accepts a clean full and production graph", () => {
  assert.deepEqual(evaluateDependencyAudits(cleanReport(), cleanReport(), patchedLockfile()), {
    ok: true,
    exceptionApplied: false,
    highOrCriticalCount: 0,
  });
});

test("dependency audit narrowly accepts the patched dev-only brace-expansion backport", () => {
  assert.deepEqual(
    evaluateDependencyAudits(braceExpansionReport(), cleanReport(), patchedLockfile()),
    {
      ok: true,
      exceptionApplied: true,
      highOrCriticalCount: 3,
    },
  );
});

test("dependency audit rejects the brace-expansion advisory on production paths", () => {
  const productionReport = braceExpansionReport();
  const result = evaluateDependencyAudits(
    braceExpansionReport(),
    productionReport,
    patchedLockfile(),
  );

  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /production dependency graph/i);
});

test("dependency audit rejects unpatched or non-dev exception nodes", () => {
  for (const packageEntry of [
    { version: "1.1.17", dev: true },
    { version: "1.1.18", dev: false },
    { version: "1.1.18" },
  ]) {
    const lockfile = patchedLockfile();
    lockfile.packages["node_modules/eslint/node_modules/brace-expansion"] = packageEntry;

    const result = evaluateDependencyAudits(braceExpansionReport(), cleanReport(), lockfile);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /patched dev-only backport/i);
  }
});

test("dependency audit rejects unrelated or untraceable high advisories", () => {
  const report = braceExpansionReport();
  report.vulnerabilities.unknown = {
    name: "unknown",
    severity: "critical",
    via: [
      {
        source: 9999999,
        name: "unknown",
        url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
        severity: "critical",
      },
    ],
    nodes: ["node_modules/unknown"],
  };
  report.metadata!.vulnerabilities!.critical = 1;
  report.metadata!.vulnerabilities!.total = 4;

  const result = evaluateDependencyAudits(report, cleanReport(), patchedLockfile());
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /not allowlisted/i);

  report.vulnerabilities.unknown.via = ["missing-vulnerability-node"];
  const untraceable = evaluateDependencyAudits(report, cleanReport(), patchedLockfile());
  assert.equal(untraceable.ok, false);
  assert.match(untraceable.reason ?? "", /not allowlisted/i);

  const cyclic = braceExpansionReport();
  cyclic.vulnerabilities["brace-expansion"].via = ["minimatch"];
  cyclic.vulnerabilities.minimatch.via = ["brace-expansion"];
  const cyclicResult = evaluateDependencyAudits(cyclic, cleanReport(), patchedLockfile());
  assert.equal(cyclicResult.ok, false);
  assert.match(cyclicResult.reason ?? "", /not allowlisted/i);

  const emptyRoot = braceExpansionReport();
  emptyRoot.vulnerabilities["brace-expansion"].via = [];
  const emptyRootResult = evaluateDependencyAudits(
    emptyRoot,
    cleanReport(),
    patchedLockfile(),
  );
  assert.equal(emptyRootResult.ok, false);
  assert.match(emptyRootResult.reason ?? "", /not allowlisted/i);
});

test("dependency audit requires a non-empty brace-expansion exception node set", () => {
  const missing = braceExpansionReport();
  delete missing.vulnerabilities["brace-expansion"];
  delete missing.vulnerabilities.minimatch;
  missing.vulnerabilities.eslint.via = [
    {
      url: ADVISORY_URL,
      severity: "high",
    },
  ];
  missing.metadata!.vulnerabilities!.high = 1;
  missing.metadata!.vulnerabilities!.total = 1;

  const missingResult = evaluateDependencyAudits(missing, cleanReport(), patchedLockfile());
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.reason ?? "", /patched dev-only backport/i);

  const empty = braceExpansionReport();
  empty.vulnerabilities["brace-expansion"].nodes = [];
  const emptyResult = evaluateDependencyAudits(empty, cleanReport(), patchedLockfile());
  assert.equal(emptyResult.ok, false);
  assert.match(emptyResult.reason ?? "", /patched dev-only backport/i);
});

test("dependency audit fails closed on report or lockfile schema drift", () => {
  const hiddenFinding = cleanReport();
  hiddenFinding.metadata!.vulnerabilities!.high = 1;
  hiddenFinding.metadata!.vulnerabilities!.total = 1;

  for (const [fullReport, productionReport, lockfile] of [
    [hiddenFinding, cleanReport(), patchedLockfile()],
    [{ ...cleanReport(), auditReportVersion: 3 }, cleanReport(), patchedLockfile()],
    [{ ...cleanReport(), metadata: undefined }, cleanReport(), patchedLockfile()],
    [
      {
        ...cleanReport(),
        metadata: { vulnerabilities: { high: -1, critical: 0 } },
      },
      cleanReport(),
      patchedLockfile(),
    ],
    [
      {
        ...cleanReport(),
        vulnerabilities: {
          malformed: {
            name: "malformed",
            severity: "high",
            via: null,
            nodes: [],
          },
        },
        metadata: { vulnerabilities: { high: 1, critical: 0 } },
      },
      cleanReport(),
      patchedLockfile(),
    ],
    [cleanReport(), cleanReport(), { ...patchedLockfile(), lockfileVersion: 4 }],
    [cleanReport(), cleanReport(), { lockfileVersion: 3, packages: null }],
  ] as const) {
    const result = evaluateDependencyAudits(
      fullReport as AuditReport,
      productionReport,
      lockfile as PackageLock,
    );
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /schema or metadata/i);
  }
});

test("package and CI contracts run the fail-closed dependency audit", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(packageJson.scripts?.["audit:dependencies"] ?? "", /audit-dependencies\.ts/);
  assert.match(workflow, /npm run audit:dependencies/);
  assert.doesNotMatch(workflow, /npm audit --audit-level=high/);
});
