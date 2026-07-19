import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USER_EXPORT_RELATION_EXCLUSIONS,
  inspectPersonalDataExportCoverage,
} from "@/lib/account-lifecycle/personal-data-policy";

const SCHEMA = `
model User {
  id       String    @id
  profile  Profile?
  sessions Session[]
}

model Profile {
  id String @id
}

model Session {
  id String @id
}
`;

test("personal-data policy requires an explicit decision for each User relation", () => {
  const report = inspectPersonalDataExportCoverage(SCHEMA, {
    select: { id: true, profile: { select: { id: true } } },
    exclusions: {},
  });

  assert.equal(report.ok, false);
  assert.match(report.diagnostics.join("\n"), /User\.sessions has no personal-data export decision/);
});

test("personal-data policy rejects duplicate and stale exclusions", () => {
  const report = inspectPersonalDataExportCoverage(SCHEMA, {
    select: { profile: { select: { id: true } } },
    exclusions: {
      profile: "duplicate decision",
      sessions: "secret",
      missing: "stale relation",
    },
  });

  assert.equal(report.ok, false);
  assert.match(report.diagnostics.join("\n"), /User\.profile is both exported and explicitly excluded/);
  assert.match(report.diagnostics.join("\n"), /User\.missing is not a Prisma User relation/);
});

test("personal-data policy rejects an unterminated User model", () => {
  const report = inspectPersonalDataExportCoverage("model User {\n  profile Profile?\n");

  assert.equal(report.ok, false);
  assert.match(report.diagnostics.join("\n"), /not terminated/);
});

test("personal-data policy covers every repository User relation", async () => {
  const schema = await readFile(resolve(import.meta.dirname, "../prisma/base.prisma"), "utf8");
  const report = inspectPersonalDataExportCoverage(schema);

  assert.equal(report.ok, true, report.diagnostics.join("\n"));
});

test("personal-data policy makes existing Today and series omissions explicit", () => {
  assert.match(USER_EXPORT_RELATION_EXCLUSIONS.todaySessions, /not part/);
  assert.match(USER_EXPORT_RELATION_EXCLUSIONS.seriesEnrollments, /not part/);
});