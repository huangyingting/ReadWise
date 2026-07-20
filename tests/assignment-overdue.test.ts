/**
 * Unit tests for the client-safe isAssignmentOverdue helper
 * (classroom/overdue.ts). Boundary cases: no due date, exactly-equal instant,
 * completed-but-past, and a genuinely overdue assignment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isAssignmentOverdue } from "@/lib/classroom/overdue";

const NOW = new Date("2026-07-20T12:00:00.000Z");

test("is not overdue when there is no due date", () => {
  assert.equal(isAssignmentOverdue(null, "IN_PROGRESS", NOW), false);
  assert.equal(isAssignmentOverdue(undefined, "ASSIGNED", NOW), false);
});

test("is overdue when the due date is in the past and not completed", () => {
  const past = new Date("2026-07-19T12:00:00.000Z");
  assert.equal(isAssignmentOverdue(past, "IN_PROGRESS", NOW), true);
});

test("is not overdue when the due date is in the future", () => {
  const future = new Date("2026-07-21T12:00:00.000Z");
  assert.equal(isAssignmentOverdue(future, "IN_PROGRESS", NOW), false);
});

test("is not overdue at the exactly-equal instant (strictly greater required)", () => {
  assert.equal(isAssignmentOverdue(new Date(NOW), "IN_PROGRESS", NOW), false);
});

test("is not overdue when completed, even if the due date has passed", () => {
  const past = new Date("2026-07-19T12:00:00.000Z");
  assert.equal(isAssignmentOverdue(past, "COMPLETED", NOW), false);
});

test("accepts an ISO string due date", () => {
  assert.equal(isAssignmentOverdue("2026-07-19T12:00:00.000Z", "ASSIGNED", NOW), true);
});

test("is not overdue when the due date string is unparseable", () => {
  assert.equal(isAssignmentOverdue("not-a-date", "ASSIGNED", NOW), false);
});
