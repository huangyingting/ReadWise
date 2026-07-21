/**
 * Source-level UI tests for classroom lifecycle controls (#1211).
 *
 * Teacher client islands mutate the existing classroom lifecycle endpoints and
 * must use shared primitives for loading/error/retry states.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type PatchCall = { url: string; body: unknown };
type DeleteCall = { url: string };
type GetCall = { url: string };

let patchCalls: PatchCall[] = [];
let deleteCalls: DeleteCall[] = [];
let getCalls: GetCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return { classrooms: [] };
      },
      patchJson: async (url: string, body: unknown) => {
        patchCalls.push({ url, body });
        return { ok: true, classroom: { id: "class-1", name: "Class 1", archivedAt: null } };
      },
      deleteJson: async (url: string) => {
        deleteCalls.push({ url });
        return { ok: true };
      },
      ApiResponseError: class ApiResponseError extends Error {
        readonly status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  patchCalls = [];
  deleteCalls = [];
  getCalls = [];
});

test("client-fetch calls match classroom lifecycle endpoints and bodies", async () => {
  await clientFetch.patchJson("/api/classrooms/class-1", { name: "Renamed" });
  await clientFetch.patchJson("/api/classrooms/class-1", { archived: true });
  await clientFetch.patchJson("/api/classrooms/class-1", { archived: false });
  await clientFetch.deleteJson("/api/classrooms/class-1");
  await clientFetch.getJson("/api/classrooms?archived=true");

  assert.deepEqual(patchCalls, [
    { url: "/api/classrooms/class-1", body: { name: "Renamed" } },
    { url: "/api/classrooms/class-1", body: { archived: true } },
    { url: "/api/classrooms/class-1", body: { archived: false } },
  ]);
  assert.deepEqual(deleteCalls, [{ url: "/api/classrooms/class-1" }]);
  assert.deepEqual(getCalls, [{ url: "/api/classrooms?archived=true" }]);
});

test("ClassroomSettingsCard wires rename, archive, unarchive, delete, and 409 copy", () => {
  const src = readSrc("src/components/teacher/ClassroomSettingsCard.tsx");

  assert.ok(src.includes('"use client"'), "is a client island");
  assert.ok(src.includes("TeacherFormShell"), "reuses the teacher form shell");
  assert.ok(src.includes("<Card"), "uses Card primitive");
  assert.ok(src.includes("<Field"), "uses Field primitive");
  assert.ok(src.includes("<Input"), "uses Input primitive");
  assert.ok(src.includes("<Button"), "uses Button primitive");
  assert.ok(src.includes("ConfirmAction"), "uses existing confirm primitive");
  assert.ok(src.includes("<PanelError"), "uses shared error primitive");
  assert.ok(src.includes("patchJson<ClassroomLifecycleResponse>"), "uses PATCH helper");
  assert.ok(src.includes("name: trimmedName"), "renames via { name } body");
  assert.ok(src.includes("archived,"), "archives/unarchives via { archived } body");
  assert.ok(src.includes("deleteJson<{ ok: true }>"), "deletes via DELETE helper");
  assert.ok(src.includes("EMPTY_CLASSROOM_DELETE_MESSAGE"), "maps 409 delete conflicts");
  assert.ok(src.includes("Classroom isn't empty — remove students and assignments first."), "has clear 409 copy");
  assert.ok(src.includes("router.refresh()"), "refreshes after lifecycle success");
  assert.ok(src.includes("isArchived ?"), "branches archived classrooms to unarchive-only actions");
});

test("ArchivedClassroomsSection fetches archived classrooms with states and unarchive action", () => {
  const src = readSrc("src/components/teacher/ArchivedClassroomsSection.tsx");

  assert.ok(src.includes('"use client"'), "is a client island");
  assert.ok(src.includes('"/api/classrooms?archived=true"'), "fetches archived query");
  assert.ok(src.includes("loadArchivedClassrooms"), "has retryable loader");
  assert.ok(src.includes("<PanelLoading"), "uses shared loading primitive");
  assert.ok(src.includes("<PanelEmpty"), "uses shared empty primitive");
  assert.ok(src.includes("<PanelError"), "uses shared error primitive");
  assert.ok(src.includes("<Button"), "uses Button primitive for retry/unarchive");
  assert.ok(src.includes("Retry"), "offers retry on load failure");
  assert.ok(src.includes("patchJson(classroomEndpoint(classroomId), { archived: false })"), "unarchives via PATCH body");
  assert.ok(src.includes("router.refresh()"), "refreshes after unarchive");
});

test("teacher pages mount classroom lifecycle UI without changing active list behavior", () => {
  const teacherPage = readSrc("src/app/(app)/teacher/page.tsx");
  const detailPage = readSrc("src/app/(app)/teacher/classrooms/[id]/page.tsx");

  assert.ok(teacherPage.includes("ArchivedClassroomsSection"), "teacher dashboard mounts archived recovery");
  assert.ok(teacherPage.includes("listClassroomsForTeacher(userId)"), "active list still uses active query");
  assert.ok(detailPage.includes("ClassroomSettingsCard"), "detail page mounts settings card");
  assert.ok(detailPage.includes("canManageActiveClassroom"), "active-only controls are gated");
  assert.ok(detailPage.includes("archivedAt={classroom.archivedAt?.toISOString() ?? null}"), "passes archived state");
});

for (const rel of [
  "src/components/teacher/ClassroomSettingsCard.tsx",
  "src/components/teacher/ArchivedClassroomsSection.tsx",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}
