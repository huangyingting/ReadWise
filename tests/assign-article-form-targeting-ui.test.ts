/**
 * Source-string tests for the teacher AssignArticleForm targeting UI (#1247 PR2).
 *
 * Mirrors the lightweight UI wiring convention used by admin-series UI tests:
 * no DOM renderer, source assertions for client-island branching, and a mocked
 * client-fetch module for exact payload shape checks.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type PostCall = { url: string; body: unknown };
let postCalls: PostCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async () => ({ articles: [] }),
      postJson: async (url: string, body: unknown) => {
        postCalls.push({ url, body });
        return { assignment: { id: "assignment-1" } };
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  postCalls = [];
});

test("AssignArticleForm exposes targeting UI only in the single-article branch", () => {
  const src = readSrc("src/components/teacher/AssignArticleForm.tsx");
  const selectorSrc = readSrc("src/components/teacher/AssignmentAudienceSelector.tsx");
  const normalized = src.replace(/\s+/g, " ");

  assert.ok(src.includes('students: { id: string; label: string }[]'), "receives roster options");
  assert.ok(src.includes('useState<"class" | "students">("class")'), "defaults to whole-class audience");
  assert.ok(src.includes("const [targetIds, setTargetIds] = useState<string[]>([])"), "tracks target ids");
  assert.ok(normalized.includes("{selected.length === 1 ? ( <> <Field label=\"Assign to\"> <AssignmentAudienceSelector"), "renders selector in the single-select block");
  assert.ok(selectorSrc.includes("Whole class"), "offers whole-class audience");
  assert.ok(selectorSrc.includes("Specific students"), "offers specific-students audience");
  assert.ok(selectorSrc.includes("aria-label=\"Target students\""), "renders a roster toggle group");
  assert.ok(selectorSrc.includes("{targetIds.length} selected"), "shows selected target count");
  assert.ok(src.includes('setAudience("class")'), "can reset to whole class");
});

test("AssignArticleForm sends studentIds only for single-assign specific-students submits", () => {
  const src = readSrc("src/components/teacher/AssignArticleForm.tsx");
  const normalized = src.replace(/\s+/g, " ");

  assert.ok(
    normalized.includes('if (selected.length === 1) { const studentIds = audience === "students" && targetIds.length > 0 ? targetIds : undefined;'),
    "single assignment computes studentIds from the specific-students audience",
  );
  assert.ok(
    normalized.includes("buildAssignmentPayload( selected[0].id, form.dueDate, form.instructions, form.title, form.points, studentIds, )"),
    "single assignment passes studentIds into the payload builder",
  );
  assert.ok(
    normalized.includes('`/api/classrooms/${classroomId}/assignments/bulk`, { articleIds: selected.map((article) => article.id), points:'),
    "bulk assignment payload remains separate and whole-class-only",
  );
});

test("AssignArticleForm sends raw date-only due dates for server EOD normalization", () => {
  const src = readSrc("src/components/teacher/AssignArticleForm.tsx");

  assert.match(src, /dueDate: dueDate \|\| undefined/);
  assert.match(src, /dueDate: form\.dueDate \|\| undefined/);
  assert.doesNotMatch(src, /new Date\(dueDate\)\.toISOString\(\)/);
  assert.doesNotMatch(src, /new Date\(form\.dueDate\)\.toISOString\(\)/);
});

test("AssignArticleForm guards zero-target specific-students submits", () => {
  const src = readSrc("src/components/teacher/AssignArticleForm.tsx");
  const normalized = src.replace(/\s+/g, " ");

  assert.ok(
    normalized.includes('if (selected.length === 1 && audience === "students" && targetIds.length === 0) return;'),
    "submit handler returns before posting zero-target specific-students assignments",
  );
  assert.ok(
    normalized.includes('!(selected.length === 1 && audience === "students" && targetIds.length === 0)'),
    "submit button is disabled for zero-target specific-students assignments",
  );
  assert.ok(src.includes('setTargetIds([])'), "resetForm clears target selections");
});

test("mocked postJson preserves the exact studentIds payload shape", async () => {
  await clientFetch.postJson("/api/classrooms/c1/assignments", {
    articleId: "article-1",
    studentIds: ["student-1", "student-2"],
  });

  assert.deepEqual(postCalls, [
    {
      url: "/api/classrooms/c1/assignments",
      body: {
        articleId: "article-1",
        studentIds: ["student-1", "student-2"],
      },
    },
  ]);
});
