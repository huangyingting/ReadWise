process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let requireManageCalls: Array<{ userId: string; classroomId: string }> = [];
let articleSearchCalls: Array<{ access: { userId: string; role: string; orgId?: string }; query: string }> = [];
let studentSearchCalls: Array<{ classroomId: string; orgId: string; query: string }> = [];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/tenant-api", {
    namedExports: {
      requireClassroomManageApi: async (
        session: { user: { id: string } },
        classroomId: string,
      ) => {
        requireManageCalls.push({ userId: session.user.id, classroomId });
        return { classroom: { id: classroomId, orgId: "org-1", teacherId: session.user.id }, membership: null };
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: (user: { id: string; role: string }, orgId?: string) => ({
        userId: user.id,
        role: user.role,
        ...(orgId ? { orgId } : {}),
      }),
    },
  });

  mock.module("@/lib/classroom", {
    namedExports: {
      searchAssignableArticleOptions: async (
        access: { userId: string; role: string; orgId?: string },
        query: string,
      ) => {
        articleSearchCalls.push({ access, query });
        return [{ id: "article-1", title: "Article" }];
      },
      searchClassroomStudentCandidates: async (classroomId: string, orgId: string, query: string) => {
        studentSearchCalls.push({ classroomId, orgId, query });
        return [{ id: "student-1", name: "Ada" }];
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  requireManageCalls = [];
  articleSearchCalls = [];
  studentSearchCalls = [];
});

async function getArticleOptions(url: string): Promise<Response> {
  const { GET } = (await import("@/app/api/classrooms/[id]/article-options/route")) as {
    GET: RouteHandler;
  };
  return GET(new Request(url), withParams({ id: "class-1" }));
}

async function getStudentCandidates(url: string): Promise<Response> {
  const { GET } = (await import("@/app/api/classrooms/[id]/student-candidates/route")) as {
    GET: RouteHandler;
  };
  return GET(new Request(url), withParams({ id: "class-1" }));
}

test("classroom picker routes require authentication", async () => {
  authState = "unauth";
  const articleResponse = await getArticleOptions("http://test/api/classrooms/class-1/article-options?q=math");
  const studentResponse = await getStudentCandidates("http://test/api/classrooms/class-1/student-candidates?q=ada");
  assert.equal(articleResponse.status, 401);
  assert.equal(studentResponse.status, 401);
});

test("classroom article-options route validates manage access and trims query", async () => {
  const longQuery = `${"x".repeat(120)} trailing`;
  const response = await getArticleOptions(
    `http://test/api/classrooms/class-1/article-options?q=${encodeURIComponent(longQuery)}`,
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { articles: Array<{ id: string }> };
  assert.equal(payload.articles[0]?.id, "article-1");

  assert.deepEqual(requireManageCalls, [{ userId: "user-1", classroomId: "class-1" }]);
  assert.equal(articleSearchCalls.length, 1);
  assert.equal(articleSearchCalls[0]?.access.userId, "user-1");
  assert.equal(articleSearchCalls[0]?.access.orgId, "org-1");
  assert.equal(articleSearchCalls[0]?.query.length, 100);
});

test("classroom student-candidates route validates manage access and returns candidates", async () => {
  const response = await getStudentCandidates(
    "http://test/api/classrooms/class-1/student-candidates?q=  ada  ",
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { candidates: Array<{ id: string }> };
  assert.equal(payload.candidates[0]?.id, "student-1");

  assert.deepEqual(requireManageCalls, [{ userId: "user-1", classroomId: "class-1" }]);
  assert.deepEqual(studentSearchCalls, [{ classroomId: "class-1", orgId: "org-1", query: "  ada" }]);
});
