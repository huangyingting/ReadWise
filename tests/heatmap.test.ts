/**
 * Unit tests for heatmap logic in src/lib/activity.ts (Issue #96).
 * Tests pure functions only — no DB, no mocking required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { heatLevel, buildHeatmapCells } from "@/lib/engagement/heatmap";

const TEST_TODAY = "2025-06-20";

function emptyActivityMap(): Map<string, number> {
  return new Map<string, number>();
}

// ---- heatLevel -----------------------------------------------------------

for (const [count, level, label] of [
  [0, 0, "0 → level 0"],
  [1, 1, "1 → level 1"],
  [2, 2, "2 → level 2"],
  [3, 2, "3 → level 2"],
  [4, 3, "4 → level 3"],
  [5, 3, "5 → level 3"],
  [6, 4, "6 → level 4"],
  [-1, 0, "negative → level 0"],
] as const) {
  test(`heatLevel: ${label}`, () => {
    assert.equal(heatLevel(count), level);
  });
}

// ---- buildHeatmapCells ---------------------------------------------------

test("buildHeatmapCells: returns exactly 365 cells", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), "2025-01-01");
  assert.equal(cells.length, 365);
});

test("buildHeatmapCells: first cell is 364 days before today", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), TEST_TODAY);
  const expectedFirst = new Date(`${TEST_TODAY}T00:00:00Z`);
  expectedFirst.setUTCDate(expectedFirst.getUTCDate() - 364);
  assert.equal(cells[0].date, expectedFirst.toISOString().slice(0, 10));
});

test("buildHeatmapCells: last cell is today", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), TEST_TODAY);
  assert.equal(cells[cells.length - 1].date, TEST_TODAY);
});

test("buildHeatmapCells: cells are ordered chronologically", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), TEST_TODAY);
  for (let i = 1; i < cells.length; i++) {
    assert.ok(cells[i].date > cells[i - 1].date, "cells should be in ascending date order");
  }
});

test("buildHeatmapCells: zero-filled by default", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), TEST_TODAY);
  assert.ok(cells.every((c) => c.count === 0 && c.level === 0));
});

test("buildHeatmapCells: maps counts from the provided activityMap", () => {
  const map = new Map<string, number>([
    [TEST_TODAY, 3],
    ["2025-06-19", 1],
  ]);
  const cells = buildHeatmapCells(map, TEST_TODAY);
  const todayCell = cells.find((c) => c.date === TEST_TODAY);
  const yesterdayCell = cells.find((c) => c.date === "2025-06-19");
  assert.ok(todayCell, "today cell should exist");
  assert.equal(todayCell!.count, 3);
  assert.equal(todayCell!.level, 2); // 3 → level 2
  assert.ok(yesterdayCell, "yesterday cell should exist");
  assert.equal(yesterdayCell!.count, 1);
  assert.equal(yesterdayCell!.level, 1); // 1 → level 1
});

test("buildHeatmapCells: dates outside the 365-day window are ignored", () => {
  const veryOld = "2020-01-01";
  const map = new Map<string, number>([[veryOld, 99]]);
  const cells = buildHeatmapCells(map, TEST_TODAY);
  const oldCell = cells.find((c) => c.date === veryOld);
  assert.equal(oldCell, undefined);
  assert.ok(cells.every((c) => c.count === 0));
});

test("buildHeatmapCells: level 4 for high count", () => {
  const map = new Map<string, number>([[TEST_TODAY, 10]]);
  const cells = buildHeatmapCells(map, TEST_TODAY);
  const todayCell = cells.find((c) => c.date === TEST_TODAY)!;
  assert.equal(todayCell.level, 4);
});

test("buildHeatmapCells: all 365 dates are unique", () => {
  const cells = buildHeatmapCells(emptyActivityMap(), TEST_TODAY);
  const dates = new Set(cells.map((c) => c.date));
  assert.equal(dates.size, 365);
});
