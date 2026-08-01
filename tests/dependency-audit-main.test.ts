import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import type { AuditReport } from "../scripts/audit-dependencies";

type SpawnResult = {
  stdout?: string;
  stderr?: string;
  error?: Error;
  status?: number;
};

const spawnCalls: string[][] = [];
let spawnResults: SpawnResult[] = [];

before(() => {
  mock.module("node:child_process", {
    namedExports: {
      spawnSync: (_command: string, args: string[]) => {
        spawnCalls.push(args);
        return spawnResults.shift() ?? { stdout: "", status: 1 };
      },
    },
  });
});

beforeEach(() => {
  spawnCalls.length = 0;
  spawnResults = [];
});

function cleanReport(): AuditReport {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { high: 0, critical: 0, total: 0 },
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
            url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
            severity: "high",
          },
        ],
        nodes: ["node_modules/eslint/node_modules/brace-expansion"],
      },
    },
    metadata: {
      vulnerabilities: { high: 1, critical: 0, total: 1 },
    },
  };
}

function result(report: AuditReport): SpawnResult {
  return { stdout: JSON.stringify(report), status: 1 };
}

test("audit CLI accepts clean full and production reports", async (t) => {
  spawnResults = [result(cleanReport()), result(cleanReport())];
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "error", () => assert.fail("clean audit must not log an error"));
  const { main } = await import("../scripts/audit-dependencies");

  assert.equal(main(), 0);
  assert.deepEqual(spawnCalls, [
    ["audit", "--json"],
    ["audit", "--json", "--omit=dev"],
  ]);
  assert.match(logs.join("\n"), /no HIGH or CRITICAL advisories/);
});

test("audit CLI reports the documented dev-only exception", async (t) => {
  spawnResults = [result(braceExpansionReport()), result(cleanReport())];
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "error", () => assert.fail("allowlisted audit must not fail"));
  const { main } = await import("../scripts/audit-dependencies");

  assert.equal(main(), 0);
  assert.match(logs.join("\n"), /dev-only backport exception/);
});

test("audit CLI rejects a production blocking advisory", async (t) => {
  spawnResults = [result(braceExpansionReport()), result(braceExpansionReport())];
  const errors: string[] = [];
  t.mock.method(console, "log", () => assert.fail("blocking audit must not pass"));
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const { main } = await import("../scripts/audit-dependencies");

  assert.equal(main(), 1);
  assert.match(errors.join("\n"), /production dependency graph/);
});

test("audit CLI fails closed when npm returns no report or malformed JSON", async (t) => {
  const errors: string[] = [];
  t.mock.method(console, "log", () => assert.fail("invalid audit output must not pass"));
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const { main } = await import("../scripts/audit-dependencies");

  spawnResults = [{ stdout: "", error: new Error("spawn failed"), status: 1 }];
  assert.equal(main(), 1);

  spawnResults = [{ stdout: "not-json", status: 1 }];
  assert.equal(main(), 1);

  assert.equal(errors.length, 2);
  assert.ok(errors.every((message) => /unable to validate npm audit output/.test(message)));
});
