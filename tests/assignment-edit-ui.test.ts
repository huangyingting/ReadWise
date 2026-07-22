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
import { buildUpdatePayload } from "@/components/teacher/editAssignmentPayload";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

const EDIT_FORM = "src/components/teacher/EditAssignmentForm.tsx";
const EDIT_PAYLOAD = "src/components/teacher/editAssignmentPayload.ts";
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
  const src = `${readSrc(EDIT_FORM)}\n${readSrc(EDIT_PAYLOAD)}`;
  assert.match(src, /dueDate,/);
  assert.doesNotMatch(src, /new Date\(dueDate\)\.toISOString\(\)/);
  assert.match(src, /instructions: instructions\.trim\(\)/);
  assert.match(src, /title: title\.trim\(\)/);
  assert.match(src, /points: points \? Number\(points\) : null/);
  assert.match(src, /audienceDirty && audience === "students" && targetIds\.length === 0/);
});

test("EditAssignmentForm omits studentIds until audience is edited", () => {
  assert.deepEqual(
    buildUpdatePayload({
      dueDate: "2026-08-01",
      instructions: "  Read closely  ",
      title: "  Chapter 1  ",
      points: "10",
      audienceDirty: false,
      audience: "students",
      targetIds: ["orphaned-student"],
    }),
    {
      dueDate: "2026-08-01",
      instructions: "Read closely",
      title: "Chapter 1",
      points: 10,
    },
  );
});

test("EditAssignmentForm sends studentIds only after audience edits", () => {
  assert.deepEqual(
    buildUpdatePayload({
      dueDate: "",
      instructions: "",
      title: "",
      points: "",
      audienceDirty: true,
      audience: "class",
      targetIds: ["orphaned-student"],
    }),
    { dueDate: "", instructions: "", title: "", points: null, studentIds: [] },
  );

  assert.deepEqual(
    buildUpdatePayload({
      dueDate: "",
      instructions: "Note",
      title: "Targeted",
      points: "5",
      audienceDirty: true,
      audience: "students",
      targetIds: ["s1", "s2"],
    }),
    {
      dueDate: "",
      instructions: "Note",
      title: "Targeted",
      points: 5,
      studentIds: ["s1", "s2"],
    },
  );
});

test("EditAssignmentForm resets draft state on open and cancel", () => {
  const src = readSrc(EDIT_FORM);
  const normalized = src.replace(/\s+/g, " ");

  assert.match(src, /function resetDraft\(\)/);
  assert.match(src, /setAudienceDirty\(false\)/);
  assert.match(
    normalized,
    /onClick=\{\(\) => \{ resetDraft\(\); setOpen\(true\); \}\}/,
    "edit button resets stale draft state before opening",
  );
  assert.match(
    normalized,
    /onClick=\{\(\) => \{ resetDraft\(\); setOpen\(false\); \}\}/,
    "cancel resets stale draft state while closing",
  );
});

test("EditAssignmentForm composes shared UI primitives and refreshes on success", () => {
  const src = readSrc(EDIT_FORM);
  assert.match(src, /@\/components\/ui\/Input/);
  assert.match(src, /@\/components\/ui\/Textarea/);
  assert.match(src, /@\/components\/ui\/Button/);
  assert.match(src, /useMutation/);
  assert.match(src, /refreshOnSuccess: true/);
  assert.match(src, /AssignmentAudienceSelector/);
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
  assert.match(src, /Whole class/);
  assert.match(src, /students<\/Badge>/);
  assert.match(src, /initialTargetIds=\{meta\?\.targetStudentIds \?\? \[\]\}/);
});
