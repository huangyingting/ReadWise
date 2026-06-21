/**
 * Unit tests for CEFR level progression data helpers (Issue #97).
 * Tests pure derivation logic — no DB, no mocking required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGLISH_LEVELS } from "@/lib/profile";
import { levelRank } from "@/lib/difficulty";

// ---- ENGLISH_LEVELS ordering ────────────────────────────────────────────

test("ENGLISH_LEVELS contains 6 CEFR levels in order", () => {
  assert.deepEqual([...ENGLISH_LEVELS], ["A1", "A2", "B1", "B2", "C1", "C2"]);
});

// ---- levelRank -----------------------------------------------------------

test("levelRank: A1 is rank 0", () => {
  assert.equal(levelRank("A1"), 0);
});

test("levelRank: B1 is rank 2", () => {
  assert.equal(levelRank("B1"), 2);
});

test("levelRank: C2 is rank 5", () => {
  assert.equal(levelRank("C2"), 5);
});

test("levelRank: unknown level returns -1", () => {
  assert.equal(levelRank("ZZ"), -1);
});

// ---- level progression derivation helpers ─────────────────────────────

/**
 * Derive next level given a current level (mirrors LevelTimeline display logic).
 * Returns null at C2 (already max).
 */
function nextLevel(current: string): string | null {
  const rank = levelRank(current);
  if (rank < 0 || rank >= ENGLISH_LEVELS.length - 1) return null;
  return ENGLISH_LEVELS[rank + 1];
}

test("nextLevel: A1 → A2", () => {
  assert.equal(nextLevel("A1"), "A2");
});

test("nextLevel: B1 → B2", () => {
  assert.equal(nextLevel("B1"), "B2");
});

test("nextLevel: C1 → C2", () => {
  assert.equal(nextLevel("C1"), "C2");
});

test("nextLevel: C2 → null (already max)", () => {
  assert.equal(nextLevel("C2"), null);
});

test("nextLevel: unknown level → null", () => {
  assert.equal(nextLevel("ZZ"), null);
});

// ---- level history deduplication ─────────────────────────────────────

/**
 * Mirrors the dedup logic in LevelTimeline.tsx.
 * Collapses consecutive identical levels into one node, marking the last as current.
 */
type StepNode = { level: string; isCurrent: boolean; date: string };

function buildTimelineNodes(history: { level: string; changedAt: string }[], current: string): StepNode[] {
  const raw: StepNode[] = history.map((e) => ({
    level: e.level,
    date: e.changedAt.slice(0, 7),
    isCurrent: false,
  }));
  raw.push({ level: current, date: "current", isCurrent: true });

  return raw.reduce<StepNode[]>((acc, node) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.isCurrent && prev.level === node.level && node.isCurrent) {
      acc[acc.length - 1] = { ...prev, isCurrent: true };
      return acc;
    }
    acc.push(node);
    return acc;
  }, []);
}

test("buildTimelineNodes: empty history → single current node", () => {
  const nodes = buildTimelineNodes([], "B1");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].level, "B1");
  assert.equal(nodes[0].isCurrent, true);
});

test("buildTimelineNodes: single level-up shows two nodes", () => {
  const nodes = buildTimelineNodes(
    [{ level: "A2", changedAt: "2025-01-15T00:00:00Z" }],
    "B1",
  );
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].level, "A2");
  assert.equal(nodes[0].isCurrent, false);
  assert.equal(nodes[1].level, "B1");
  assert.equal(nodes[1].isCurrent, true);
});

test("buildTimelineNodes: merges last node when history === current", () => {
  const nodes = buildTimelineNodes(
    [{ level: "B1", changedAt: "2025-01-15T00:00:00Z" }],
    "B1",
  );
  // The history entry and the current entry are the same level —
  // they collapse into one node marked isCurrent.
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].level, "B1");
  assert.equal(nodes[0].isCurrent, true);
});

test("buildTimelineNodes: multiple distinct level changes", () => {
  const history = [
    { level: "A1", changedAt: "2024-01-01T00:00:00Z" },
    { level: "A2", changedAt: "2024-06-01T00:00:00Z" },
    { level: "B1", changedAt: "2025-01-01T00:00:00Z" },
  ];
  const nodes = buildTimelineNodes(history, "B1");
  // B1 from history + B1 current → merge to 3 nodes (A1, A2, B1-current)
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].level, "A1");
  assert.equal(nodes[1].level, "A2");
  assert.equal(nodes[2].level, "B1");
  assert.equal(nodes[2].isCurrent, true);
});

test("buildTimelineNodes: level-down followed by recovery shows all nodes", () => {
  const history = [
    { level: "B2", changedAt: "2024-01-01T00:00:00Z" },
    { level: "B1", changedAt: "2024-03-01T00:00:00Z" },
    { level: "B2", changedAt: "2024-09-01T00:00:00Z" },
  ];
  const nodes = buildTimelineNodes(history, "B2");
  // Last history B2 + current B2 → collapse
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].level, "B2");
  assert.equal(nodes[1].level, "B1");
  assert.equal(nodes[2].level, "B2");
  assert.equal(nodes[2].isCurrent, true);
});
