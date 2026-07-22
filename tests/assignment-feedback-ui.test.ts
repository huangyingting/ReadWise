/**
 * Source-string UI wiring tests for the teacher feedback feature (#1246).
 *
 * jsdom-free per repo convention: asserts against the component/page source
 * (readFileSync) to lock in the PATCH endpoint shape, feedback body key,
 * and the read-only feedback display on the student surfaces.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

const FEEDBACK_FORM = "src/components/teacher/AssignmentFeedbackForm.tsx";
const ASSIGNMENT_BANNER = "src/app/(app)/reader/[id]/AssignmentBanner.tsx";
const STUDENT_PAGE = "src/app/(app)/assignments/page.tsx";

const NO_RAW_HEX = /#[0-9a-fA-F]{3,6}\b/;
const NO_INLINE_FONT_SIZE = /fontSize|style=\{\{/;

// ---------------------------------------------------------------------------
// AssignmentFeedbackForm island
// ---------------------------------------------------------------------------

test("AssignmentFeedbackForm is a client island", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.match(src, /^"use client";/);
});

test("AssignmentFeedbackForm calls patchJson with the completions endpoint", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.match(src, /patchJson/);
  assert.match(src, /\/api\/assignments\//);
  assert.match(src, /completions\//);
});

test("AssignmentFeedbackForm sends feedback in the PATCH body", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.match(src, /feedback/);
  assert.match(src, /\{ feedback/);
});

test("AssignmentFeedbackForm uses shared UI primitives", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.match(src, /@\/components\/ui\/Textarea/);
  assert.match(src, /@\/components\/ui\/Field/);
});

test("AssignmentFeedbackForm respects max-length of 2000", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.match(src, /2000/);
});

test("AssignmentFeedbackForm is token-driven (no raw hex, no inline font size)", () => {
  const src = readSrc(FEEDBACK_FORM);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});

// ---------------------------------------------------------------------------
// Student read-only surfaces — feedback display present
// ---------------------------------------------------------------------------

test("AssignmentBanner references assignment.feedback for read-only display", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /assignment\.feedback/);
  assert.match(src, /Teacher feedback/);
});

test("AssignmentBanner feedback display is token-driven", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});

test("student assignments page references assignment.feedback for read-only display", () => {
  const src = readSrc(STUDENT_PAGE);
  assert.match(src, /assignment\.feedback/);
  assert.match(src, /Teacher feedback/);
});

test("student assignments page feedback display is token-driven", () => {
  const src = readSrc(STUDENT_PAGE);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});
