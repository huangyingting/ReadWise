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
const EMPTY_GRADE_COUNTS = { again: 0, hard: 0, good: 0, easy: 0 };

type SessionState = Extract<AppState, { phase: "session" }>;
type CompleteState = Extract<AppState, { phase: "complete" }>;

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    phase: "session",
    mode: "flashcard",
    cards: [CARD],
    index: 0,
    flipped: false,
    grading: false,
    gradeCounts: { ...EMPTY_GRADE_COUNTS },
    clozeInput: "",
    clozeSubmitted: false,
    clozeCorrect: null,
    ...overrides,
  };
}

function assertSessionState(state: AppState): SessionState {
  assert.equal(state.phase, "session");
  if (state.phase !== "session") throw new Error("narrow");
  return state;
}

function assertCompleteState(state: AppState): CompleteState {
  assert.equal(state.phase, "complete");
  if (state.phase !== "complete") throw new Error("narrow");
  return state;
}

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
  const session = assertSessionState(state);
  assert.equal(session.index, 0);
  assert.equal(session.flipped, false);
  assert.equal(session.grading, false);
  assert.equal(session.clozeInput, "");
  assert.equal(session.clozeSubmitted, false);
  assert.equal(session.clozeCorrect, null);
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
  const session = assertSessionState(state);
  assert.equal(session.mode, "cloze");
});

// ── LOAD_FAILED ───────────────────────────────────────────────────────────

test("LOAD_FAILED transitions loading → idle", () => {
  const state = reviewSessionReducer(LOADING, { type: "LOAD_FAILED" });
  assert.equal(state.phase, "idle");
});

// ── FLIP ─────────────────────────────────────────────────────────────────

test("FLIP flips an unflipped session card", () => {
  const session = sessionState();
  const state = reviewSessionReducer(session, { type: "FLIP" });
  assert.equal(assertSessionState(state).flipped, true);
});

test("FLIP is a no-op when already flipped", () => {
  const session = sessionState({ flipped: true });
  const result = reviewSessionReducer(session, { type: "FLIP" });
  assert.strictEqual(result, session);
});

// ── CLOZE_INPUT ───────────────────────────────────────────────────────────

test("CLOZE_INPUT updates clozeInput", () => {
  const session = sessionState({ mode: "cloze" });
  const state = reviewSessionReducer(session, {
    type: "CLOZE_INPUT",
    input: "ephemeral",
  });
  assert.equal(assertSessionState(state).clozeInput, "ephemeral");
});

// ── CLOZE_SUBMIT ──────────────────────────────────────────────────────────

test("CLOZE_SUBMIT marks submitted and correct=true", () => {
  const session = sessionState({
    mode: "cloze",
    clozeInput: "ephemeral",
  });
  const state = reviewSessionReducer(session, {
    type: "CLOZE_SUBMIT",
    correct: true,
  });
  const next = assertSessionState(state);
  assert.equal(next.clozeSubmitted, true);
  assert.equal(next.clozeCorrect, true);
});

test("CLOZE_SUBMIT marks submitted and correct=false", () => {
  const session = sessionState({
    mode: "cloze",
    clozeInput: "wrong",
  });
  const state = reviewSessionReducer(session, {
    type: "CLOZE_SUBMIT",
    correct: false,
  });
  assert.equal(assertSessionState(state).clozeCorrect, false);
});

// ── GRADE_OPTIMISTIC ──────────────────────────────────────────────────────

test("GRADE_OPTIMISTIC sets grading=true", () => {
  const session = sessionState({ flipped: true });
  const state = reviewSessionReducer(session, { type: "GRADE_OPTIMISTIC" });
  assert.equal(assertSessionState(state).grading, true);
});

// ── GRADE_ADVANCE ─────────────────────────────────────────────────────────

test("GRADE_ADVANCE with more cards → advances index and resets card state", () => {
  const session = sessionState({
    cards: [CARD, CARD2],
    flipped: true,
    grading: true,
  });
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "good",
  });
  const next = assertSessionState(state);
  assert.equal(next.index, 1);
  assert.equal(next.flipped, false);
  assert.equal(next.grading, false);
  assert.equal(next.gradeCounts.good, 1);
  assert.equal(next.clozeInput, "");
  assert.equal(next.clozeSubmitted, false);
});

test("GRADE_ADVANCE on last card → complete phase", () => {
  const session = sessionState({
    flipped: true,
    grading: true,
  });
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "easy",
  });
  const complete = assertCompleteState(state);
  assert.equal(complete.total, 1);
  assert.equal(complete.gradeCounts.easy, 1);
});

test("GRADE_ADVANCE increments the correct grade bucket", () => {
  const session = sessionState({
    cards: [CARD, CARD2],
    flipped: true,
    gradeCounts: { again: 1, hard: 0, good: 0, easy: 0 },
  });
  const state = reviewSessionReducer(session, {
    type: "GRADE_ADVANCE",
    grade: "again",
  });
  assert.equal(assertSessionState(state).gradeCounts.again, 2);
});

// ── END_SESSION ───────────────────────────────────────────────────────────

test("END_SESSION from session → idle", () => {
  const session = sessionState();
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
