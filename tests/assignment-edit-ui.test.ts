/**
 * Source-string UI wiring tests for the assignment sub-system (#1164).
 *
 * jsdom-free per repo convention: assert against the component/page source
 * (readFileSync) to lock in the PATCH endpoint/body of the EditAssignmentForm
 * island, the Undo (revert) affordance, and the Overdue Badge on both the
 * student and teacher surfaces — all token-driven, no raw hex / inline font size.
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

const EDIT_FORM = "src/components/teacher/EditAssignmentForm.tsx";
const COMPLETE_BUTTON = "src/components/teacher/CompleteAssignmentButton.tsx";
const STUDENT_PAGE = "src/app/(app)/assignments/page.tsx";
const TEACHER_PAGE = "src/app/(app)/teacher/classrooms/[id]/page.tsx";

const NO_RAW_HEX = /#[0-9a-fA-F]{3,6}\b/;
const NO_INLINE_FONT_SIZE = /fontSize|style=\{\{/;

// ---------------------------------------------------------------------------
// EditAssignmentForm island
// ---------------------------------------------------------------------------

test("EditAssignmentForm is a client island that PATCHes the assignment endpoint", () => {
  const src = readSrc(EDIT_FORM);
  assert.match(src, /^"use client";/);
  assert.match(src, /patchJson/);
  assert.match(src, /`\/api\/assignments\/\$\{encodeURIComponent\(assignmentId\)\}`/);
});

test("EditAssignmentForm sends assignment metadata in the PATCH body", () => {
  const src = readSrc(EDIT_FORM);
  assert.match(src, /\.\.\.\(dueDate \? \{ dueDate \} : \{\}\)/);
  assert.doesNotMatch(src, /new Date\(dueDate\)\.toISOString\(\)/);
  assert.match(src, /instructions: instructions\.trim\(\)/);
  assert.match(src, /title: title\.trim\(\)/);
  assert.match(src, /points: Number\(points\)/);
});

test("EditAssignmentForm composes shared UI primitives and refreshes on success", () => {
  const src = readSrc(EDIT_FORM);
  assert.match(src, /@\/components\/ui\/Input/);
  assert.match(src, /@\/components\/ui\/Textarea/);
  assert.match(src, /@\/components\/ui\/Button/);
  assert.match(src, /useMutation/);
  assert.match(src, /refreshOnSuccess: true/);
});

test("EditAssignmentForm is token-driven (no raw hex, no inline font size)", () => {
  const src = readSrc(EDIT_FORM);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});

// ---------------------------------------------------------------------------
// CompleteAssignmentButton — manual revert (Part 4)
// ---------------------------------------------------------------------------

test("CompleteAssignmentButton offers Undo only for manual (quizScore null) completions", () => {
  const src = readSrc(COMPLETE_BUTTON);
  assert.match(src, /IN_PROGRESS/);
  assert.match(src, /quizScore != null/);
  assert.match(src, /Undo/);
});

// ---------------------------------------------------------------------------
// Overdue badge — student + teacher surfaces
// ---------------------------------------------------------------------------

test("student assignments page renders an Overdue Badge via isAssignmentOverdue", () => {
  const src = readSrc(STUDENT_PAGE);
  assert.match(src, /isAssignmentOverdue/);
  assert.match(src, /variant="danger"/);
  assert.match(src, />\s*Overdue\s*</);
  assert.doesNotMatch(src, NO_RAW_HEX);
});

test("teacher classroom page renders an Overdue Badge and the EditAssignmentForm island", () => {
  const src = readSrc(TEACHER_PAGE);
  assert.match(src, /isAssignmentOverdue/);
  assert.match(src, /EditAssignmentForm/);
  assert.match(src, /Overdue/);
  assert.match(src, /listClassroomAssignmentMeta/);
});
