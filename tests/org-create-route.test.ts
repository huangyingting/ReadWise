process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let createOrgCalls: Array<{ input: { name: string; slug?: string }; userId: string }> = [];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/org", {
    namedExports: {
      createOrganization: async (input: { name: string; slug?: string }, userId: string) => {
        createOrgCalls.push({ input, userId });
        return {
          organization: { id: "org-1", ...input },
          membership: { id: "membership-1", orgId: "org-1", userId, role: "OrgAdmin" },
        };
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  createOrgCalls = [];
});

async function postOrg(body: unknown): Promise<Response> {
  const { POST } = (await import("@/app/api/orgs/route")) as { POST: RouteHandler };
  return POST(jsonPost("http://test/api/orgs", body));
}

test("org create route requires authentication", async () => {
  authState = "unauth";
  const response = await postOrg({ name: "ReadWise Org" });
  assert.equal(response.status, 401);
});

test("org create route validates body schema", async () => {
  const missingName = await postOrg({ slug: "x" });
  assert.equal(missingName.status, 400);

  const tooLong = await postOrg({ name: "x".repeat(121) });
  assert.equal(tooLong.status, 400);

  assert.equal(createOrgCalls.length, 0);
});

test("org create route creates organization and returns membership", async () => {
  const response = await postOrg({ name: "ReadWise Org", slug: "readwise" });

  assert.equal(response.status, 201);
  const payload = (await response.json()) as {
    organization: { id: string; name: string; slug?: string };
    membership: { role: string };
  };
  assert.equal(payload.organization.id, "org-1");
  assert.equal(payload.organization.slug, "readwise");
  assert.equal(payload.membership.role, "OrgAdmin");

  assert.deepEqual(createOrgCalls, [
    { input: { name: "ReadWise Org", slug: "readwise" }, userId: "user-1" },
  ]);
});
