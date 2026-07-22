import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assignmentLiveWhere,
  assignmentVisibleToStudentWhere,
  effectiveStudentIds,
} from "@/lib/classroom/targeting";

test("assignmentVisibleToStudentWhere matches whole-class or targeted assignments", () => {
  assert.deepEqual(assignmentVisibleToStudentWhere("s1"), {
    OR: [{ targets: { none: {} } }, { targets: { some: { studentId: "s1" } } }],
  });

  test("assignmentLiveWhere matches published or reached scheduled assignments", () => {
    const now = new Date("2026-07-22T09:00:00.000Z");
    assert.deepEqual(assignmentLiveWhere(now), {
      OR: [
        { publishState: "PUBLISHED" },
        { publishState: "SCHEDULED", publishAt: { lte: now } },
      ],
    });
  });
});

test("effectiveStudentIds treats null or empty targets as the whole enrolled roster", () => {
  assert.deepEqual(effectiveStudentIds(["s1", "s2"], null), ["s1", "s2"]);
  assert.deepEqual(effectiveStudentIds(["s1", "s2"], undefined), ["s1", "s2"]);
  assert.deepEqual(effectiveStudentIds(["s1", "s2"], []), ["s1", "s2"]);
});

test("effectiveStudentIds returns targeted students intersected with the enrolled roster", () => {
  assert.deepEqual(effectiveStudentIds(["s1", "s2"], ["s2", "ghost", "s1"]), ["s2", "s1"]);
});
