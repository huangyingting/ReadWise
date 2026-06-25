/**
 * Unit tests for heatmap logic in src/lib/activity.ts (Issue #96).
 * Tests pure functions only — no DB, no mocking required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { heatLevel, buildHeatmapCells } from "@/lib/engagement/heatmap";

// ---- heatLevel -----------------------------------------------------------

test("heatLevel: 0 → level 0", () => {
  assert.equal(heatLevel(0), 0);
});

test("heatLevel: 1 → level 1", () => {
  assert.equal(heatLevel(1), 1);
});

test("heatLevel: 2 → level 2", () => {
  assert.equal(heatLevel(2), 2);
});

test("heatLevel: 3 → level 2", () => {
  assert.equal(heatLevel(3), 2);
});

test("heatLevel: 4 → level 3", () => {
  assert.equal(heatLevel(4), 3);
});

test("heatLevel: 5 → level 3", () => {
  assert.equal(heatLevel(5), 3);
});

test("heatLevel: 6 → level 4", () => {
  assert.equal(heatLevel(6), 4);
});

test("heatLevel: negative → level 0", () => {
  assert.equal(heatLevel(-1), 0);
});

// ---- buildHeatmapCells ---------------------------------------------------

test("buildHeatmapCells: returns exactly 365 cells", () => {
  const map = new Map<string, number>();
  const cells = buildHeatmapCells(map, "2025-01-01");
  assert.equal(cells.length, 365);
});

test("buildHeatmapCells: first cell is 364 days before today", () => {
  const map = new Map<string, number>();
  const today = "2025-06-20";
  const cells = buildHeatmapCells(map, today);
  const expectedFirst = new Date("2025-06-20T00:00:00Z");
  expectedFirst.setUTCDate(expectedFirst.getUTCDate() - 364);
  assert.equal(cells[0].date, expectedFirst.toISOString().slice(0, 10));
});

test("buildHeatmapCells: last cell is today", () => {
  const map = new Map<string, number>();
  const today = "2025-06-20";
  const cells = buildHeatmapCells(map, today);
  assert.equal(cells[cells.length - 1].date, today);
});

test("buildHeatmapCells: cells are ordered chronologically", () => {
  const map = new Map<string, number>();
  const cells = buildHeatmapCells(map, "2025-06-20");
  for (let i = 1; i < cells.length; i++) {
    assert.ok(cells[i].date > cells[i - 1].date, "cells should be in ascending date order");
  }
});

test("buildHeatmapCells: zero-filled by default", () => {
  const map = new Map<string, number>();
  const cells = buildHeatmapCells(map, "2025-06-20");
  assert.ok(cells.every((c) => c.count === 0 && c.level === 0));
});

test("buildHeatmapCells: maps counts from the provided activityMap", () => {
  const today = "2025-06-20";
  const map = new Map<string, number>([
    [today, 3],
    ["2025-06-19", 1],
  ]);
  const cells = buildHeatmapCells(map, today);
  const todayCell = cells.find((c) => c.date === today);
  const yesterdayCell = cells.find((c) => c.date === "2025-06-19");
  assert.ok(todayCell, "today cell should exist");
  assert.equal(todayCell!.count, 3);
  assert.equal(todayCell!.level, 2); // 3 → level 2
  assert.ok(yesterdayCell, "yesterday cell should exist");
  assert.equal(yesterdayCell!.count, 1);
  assert.equal(yesterdayCell!.level, 1); // 1 → level 1
});

test("buildHeatmapCells: dates outside the 365-day window are ignored", () => {
  const today = "2025-06-20";
  const veryOld = "2020-01-01";
  const map = new Map<string, number>([[veryOld, 99]]);
  const cells = buildHeatmapCells(map, today);
  const oldCell = cells.find((c) => c.date === veryOld);
  assert.equal(oldCell, undefined);
  assert.ok(cells.every((c) => c.count === 0));
});

test("buildHeatmapCells: level 4 for high count", () => {
  const today = "2025-06-20";
  const map = new Map<string, number>([[today, 10]]);
  const cells = buildHeatmapCells(map, today);
  const todayCell = cells.find((c) => c.date === today)!;
  assert.equal(todayCell.level, 4);
});

test("buildHeatmapCells: all 365 dates are unique", () => {
  const map = new Map<string, number>();
  const cells = buildHeatmapCells(map, "2025-06-20");
  const dates = new Set(cells.map((c) => c.date));
  assert.equal(dates.size, 365);
});
