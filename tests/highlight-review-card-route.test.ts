process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let convertResult:
  | { cardId: string; dueAt: Date | null; created: boolean }
  | null = null;
let convertCalls: Array<{ userId: string; highlightId: string }> = [];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/learning/review-assets", {
    namedExports: {
      convertHighlightToReviewCard: async (userId: string, highlightId: string) => {
        convertCalls.push({ userId, highlightId });
        return convertResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  convertResult = { cardId: "card-1", dueAt: new Date("2026-07-11T08:08:13.000Z"), created: true };
  convertCalls = [];
});

async function postReviewCard(id = "h-1"): Promise<Response> {
  const { POST } = (await import("@/app/api/highlights/[id]/review-card/route")) as {
    POST: RouteHandler;
  };
  return POST(new Request(`http://test/api/highlights/${id}/review-card`, { method: "POST" }), withParams({ id }));
}

test("highlight review-card route requires authentication", async () => {
  authState = "unauth";
  const response = await postReviewCard();
  assert.equal(response.status, 401);
});

test("highlight review-card route returns 404 when conversion target is missing", async () => {
  convertResult = null;
  const response = await postReviewCard("missing");
  assert.equal(response.status, 404);
  assert.deepEqual(convertCalls, [{ userId: "user-1", highlightId: "missing" }]);
});

test("highlight review-card route returns card payload with ISO dueAt and created flag", async () => {
  const response = await postReviewCard("h-9");
  assert.equal(response.status, 200);

  const payload = (await response.json()) as { cardId: string; dueAt: string | null; created: boolean };
  assert.deepEqual(payload, {
    cardId: "card-1",
    dueAt: "2026-07-11T08:08:13.000Z",
    created: true,
  });

  convertResult = { cardId: "card-1", dueAt: null, created: false };
  const existingResponse = await postReviewCard("h-9");
  assert.equal(existingResponse.status, 200);
  assert.deepEqual(await existingResponse.json(), {
    cardId: "card-1",
    dueAt: null,
    created: false,
  });
});
