/**
 * Unit tests for the reviewSessionReducer pure function.
 * Tests session transitions without rendering any React components.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewSessionReducer,
} from "@/components/flashcard/reviewSessionReducer";
import type { AppState } from "@/components/flashcard/types";

const CARD = {
  id: "card-1",
  word: "ephemeral",
  explanation: "Lasting for a very short time.",
  example: "The ephemeral beauty of cherry blossoms.",
  contextSentence: null,
  articleId: null,
};

const CARD2 = { ...CARD, id: "card-2", word: "laconic" };

const IDLE: AppState = { phase: "idle" };
const LOADING: AppState = { phase: "loading" };

// ── START_LOADING ─────────────────────────────────────────────────────────

test("START_LOADING transitions idle → loading", () => {
  const state = reviewSessionReducer(IDLE, { type: "START_LOADING" });
  assert.equal(state.phase, "loading");
});

// ── SESSION_LOADED ────────────────────────────────────────────────────────

test("SESSION_LOADED with cards → session phase", () => {
  const state = reviewSessionReducer(LOADING, {
    type: "SESSION_LOADED",
    mode: "flashcard",
    cards: [CARD],
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.index, 0);
  assert.equal(state.flipped, false);
  assert.equal(state.grading, false);
  assert.equal(state.clozeInput, "");
  assert.equal(state.clozeSubmitted, false);
  assert.equal(state.clozeCorrect, null);
});

test("SESSION_LOADED with empty cards → idle", () => {
  const state = reviewSessionReducer(LOADING, {
    type: "SESSION_LOADED",
    mode: "flashcard",
    cards: [],
  });
  assert.equal(state.phase, "idle");
});

test("SESSION_LOADED sets cloze mode", () => {
  const state = reviewSessionReducer(LOADING, {
    type: "SESSION_LOADED",
    mode: "cloze",
    cards: [CARD],
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.mode, "cloze");
});

// ── LOAD_FAILED ───────────────────────────────────────────────────────────

test("LOAD_FAILED transitions loading → idle", () => {
  const state = reviewSessionReducer(LOADING, { type: "LOAD_FAILED" });
  assert.equal(state.phase, "idle");
});

// ── FLIP ─────────────────────────────────────────────────────────────────

test("FLIP flips an unflipped session card", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, { type: "FLIP" });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.flipped, true);
});

test("FLIP is a no-op when already flipped", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: true,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const result = reviewSessionReducer(session, { type: "FLIP" });
  assert.strictEqual(result, session);
});

// ── CLOZE_INPUT ───────────────────────────────────────────────────────────

test("CLOZE_INPUT updates clozeInput", () => {
  const session: AppState = {
    phase: "session",
    mode: "cloze",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "CLOZE_INPUT",
    input: "ephemeral",
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.clozeInput, "ephemeral");
});

// ── CLOZE_SUBMIT ──────────────────────────────────────────────────────────

test("CLOZE_SUBMIT marks submitted and correct=true", () => {
  const session: AppState = {
    phase: "session",
    mode: "cloze",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "ephemeral",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "CLOZE_SUBMIT",
    correct: true,
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.clozeSubmitted, true);
  assert.equal(state.clozeCorrect, true);
});

test("CLOZE_SUBMIT marks submitted and correct=false", () => {
  const session: AppState = {
    phase: "session",
    mode: "cloze",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "wrong",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "CLOZE_SUBMIT",
    correct: false,
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.clozeCorrect, false);
});

// ── GRADE_OPTIMISTIC ──────────────────────────────────────────────────────

test("GRADE_OPTIMISTIC sets grading=true", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: true,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, { type: "GRADE_OPTIMISTIC" });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.grading, true);
});

// ── GRADE_ADVANCE ─────────────────────────────────────────────────────────

test("GRADE_ADVANCE with more cards → advances index and resets card state", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD, CARD2],
    index: 0,
    flipped: true,
    grading: true,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "good",
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.index, 1);
  assert.equal(state.flipped, false);
  assert.equal(state.grading, false);
  assert.equal(state.gradeCounts.good, 1);
  assert.equal(state.clozeInput, "");
  assert.equal(state.clozeSubmitted, false);
});

test("GRADE_ADVANCE on last card → complete phase", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: true,
    grading: true,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "easy",
  });
  assert.equal(state.phase, "complete");
  if (state.phase !== "complete") throw new Error("narrow");
  assert.equal(state.total, 1);
  assert.equal(state.gradeCounts.easy, 1);
});

test("GRADE_ADVANCE increments the correct grade bucket", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD, CARD2],
    index: 0,
    flipped: true,
    grading: false,
    gradeCounts: { again: 1, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "again",
  });
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  assert.equal(state.gradeCounts.again, 2);
});

// ── END_SESSION ───────────────────────────────────────────────────────────

test("END_SESSION from session → idle", () => {
  const session: AppState = {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
  };
  const state = reviewSessionReducer(session, { type: "END_SESSION" });
  assert.equal(state.phase, "idle");
});

test("END_SESSION from complete → idle", () => {
  const complete: AppState = {
    phase: "complete",
    total: 3,
    gradeCounts: { again: 0, hard: 1, good: 1, easy: 1 },
  };
  const state = reviewSessionReducer(complete, { type: "END_SESSION" });
  assert.equal(state.phase, "idle");
});
