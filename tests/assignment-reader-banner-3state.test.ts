/**
 * UI + helper tests for the assignment lifecycle PR2 deliverables (RW-061):
 *   1. AssignmentBanner component (source-string assertions — jsdom-free)
 *   2. assignmentStatusDisplay helper (pure function, all 3 mappings)
 *   3. Reader page-loader change (studentAssignments included in ReaderPageData)
 *   4. Student assignments page (3-state status badge)
 *   5. Teacher classroom page (3-segment assignment summary)
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { assignmentStatusDisplay } from "@/lib/assignment-status";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

const ASSIGNMENT_BANNER = "src/app/(app)/reader/[id]/AssignmentBanner.tsx";
const READER_SHELL = "src/app/(app)/reader/[id]/ReaderShell.tsx";
const PAGE_LOADER = "src/lib/reader/page-loader.ts";
const STUDENT_PAGE = "src/app/(app)/assignments/page.tsx";
const TEACHER_PAGE = "src/app/(app)/teacher/classrooms/[id]/page.tsx";
const ASSIGNMENT_STATUS_LIB = "src/lib/assignment-status.ts";

const NO_RAW_HEX = /#[0-9a-fA-F]{3,6}\b/;
const NO_INLINE_FONT_SIZE = /fontSize|style=\{\{/;

// ---------------------------------------------------------------------------
// assignmentStatusDisplay — pure helper, all 3 mappings
// ---------------------------------------------------------------------------

test("assignmentStatusDisplay maps COMPLETED to success variant", () => {
  const result = assignmentStatusDisplay("COMPLETED");
  assert.equal(result.label, "Completed");
  assert.equal(result.variant, "success");
});

test("assignmentStatusDisplay maps IN_PROGRESS to primary variant", () => {
  const result = assignmentStatusDisplay("IN_PROGRESS");
  assert.equal(result.label, "In progress");
  assert.equal(result.variant, "primary");
});

test("assignmentStatusDisplay maps ASSIGNED (not started) to neutral variant", () => {
  const result = assignmentStatusDisplay("ASSIGNED");
  assert.equal(result.label, "Not started");
  assert.equal(result.variant, "neutral");
});

test("assignmentStatusDisplay maps unknown status to neutral/not-started fallback", () => {
  const result = assignmentStatusDisplay("UNKNOWN");
  assert.equal(result.label, "Not started");
  assert.equal(result.variant, "neutral");
});

// ---------------------------------------------------------------------------
// assignment-status.ts — source checks
// ---------------------------------------------------------------------------

test("assignment-status lib has no server-only imports", () => {
  const src = readSrc(ASSIGNMENT_STATUS_LIB);
  assert.doesNotMatch(src, /@prisma\/client/);
  assert.doesNotMatch(src, /@\/lib\/prisma/);
});

// ---------------------------------------------------------------------------
// AssignmentBanner — source-string wiring checks
// ---------------------------------------------------------------------------

test("AssignmentBanner renders null when assignments is empty", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /assignments\.length === 0.*return null/s);
});

test("AssignmentBanner renders classroomName, due date, and instructions", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /classroomName/);
  assert.match(src, /formatMediumDate/);
  assert.match(src, /instructions/);
});

test("AssignmentBanner wires CompleteAssignmentButton to the correct assignmentId", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /CompleteAssignmentButton/);
  assert.match(src, /assignmentId={assignment\.assignmentId}/);
});

test("AssignmentBanner uses isAssignmentOverdue and shows Overdue badge", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /isAssignmentOverdue/);
  assert.match(src, /variant="danger"/);
  assert.match(src, /Overdue/);
});

test("AssignmentBanner uses assignmentStatusDisplay for the status chip", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /assignmentStatusDisplay/);
});

test("AssignmentBanner is token-driven (no raw hex, no inline font size)", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});

test("AssignmentBanner uses shared UI primitives (Card, Badge)", () => {
  const src = readSrc(ASSIGNMENT_BANNER);
  assert.match(src, /@\/components\/ui\/Badge/);
  assert.match(src, /@\/components\/ui\/Card/);
});

// ---------------------------------------------------------------------------
// ReaderShell — threads studentAssignments and renders AssignmentBanner
// ---------------------------------------------------------------------------

test("ReaderShell imports and renders AssignmentBanner", () => {
  const src = readSrc(READER_SHELL);
  assert.match(src, /import AssignmentBanner from ".\/AssignmentBanner"/);
  assert.match(src, /AssignmentBanner/);
  assert.match(src, /assignments={studentAssignments}/);
});

test("ReaderShell destructures studentAssignments from data", () => {
  const src = readSrc(READER_SHELL);
  assert.match(src, /studentAssignments/);
});

// ---------------------------------------------------------------------------
// Reader page-loader — studentAssignments in ReaderPageData
// ---------------------------------------------------------------------------

test("page-loader ReaderPageData includes studentAssignments field", () => {
  const src = readSrc(PAGE_LOADER);
  assert.match(src, /studentAssignments:\s*StudentAssignment\[\]/);
});

test("page-loader imports listStudentAssignmentsForArticle from @/lib/classroom", () => {
  const src = readSrc(PAGE_LOADER);
  assert.match(src, /listStudentAssignmentsForArticle/);
  assert.match(src, /@\/lib\/classroom/);
});

test("page-loader includes listStudentAssignmentsForArticle in Promise.all", () => {
  const src = readSrc(PAGE_LOADER);
  assert.match(
    src,
    /listStudentAssignmentsForArticle\(session\.user\.id,\s*article\.id\)/,
  );
});

test("page-loader returns studentAssignments in the result object", () => {
  const src = readSrc(PAGE_LOADER);
  // The returned object must include studentAssignments
  assert.match(src, /studentAssignments,/);
});

// ---------------------------------------------------------------------------
// Student assignments page — 3-state status chip
// ---------------------------------------------------------------------------

test("student assignments page imports assignmentStatusDisplay", () => {
  const src = readSrc(STUDENT_PAGE);
  assert.match(src, /assignmentStatusDisplay/);
  assert.match(src, /@\/lib\/assignment-status/);
});

test("student assignments page shows IN_PROGRESS via status badge (not hard-coded string)", () => {
  const src = readSrc(STUDENT_PAGE);
  // Uses the shared helper's label, not a hard-coded "In progress" string inline
  assert.match(src, /statusLabel/);
  assert.match(src, /statusVariant/);
});

test("student assignments page is still token-driven after 3-state update", () => {
  const src = readSrc(STUDENT_PAGE);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});

// ---------------------------------------------------------------------------
// Teacher classroom page — 3-segment assignment summary
// ---------------------------------------------------------------------------

test("teacher classroom page assignmentSummary shows inProgress count", () => {
  const src = readSrc(TEACHER_PAGE);
  assert.match(src, /assignment\.inProgress/);
});

test("teacher classroom page assignmentSummary shows notStarted count", () => {
  const src = readSrc(TEACHER_PAGE);
  assert.match(src, /assignment\.notStarted/);
});

test("teacher classroom page assignmentSummary shows completed count", () => {
  const src = readSrc(TEACHER_PAGE);
  assert.match(src, /assignment\.completed/);
});

test("teacher classroom page is still token-driven after summary update", () => {
  const src = readSrc(TEACHER_PAGE);
  assert.doesNotMatch(src, NO_RAW_HEX);
  assert.doesNotMatch(src, NO_INLINE_FONT_SIZE);
});
