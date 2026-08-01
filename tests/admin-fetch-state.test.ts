import assert from "node:assert/strict";
import test from "node:test";

import {
  adminFetchErrorState,
  classifyAdminFetchError,
} from "@/lib/admin/admin-fetch-state";
import { ApiResponseError } from "@/lib/client-fetch";

test("admin fetch classification preserves controlled API messages", () => {
  assert.deepEqual(
    classifyAdminFetchError(new ApiResponseError(404, "Discovery source not found.")),
    { kind: "notFound", message: "Discovery source not found." },
  );
  assert.deepEqual(
    classifyAdminFetchError(new ApiResponseError(503, "Service temporarily unavailable.")),
    {
      kind: "generic",
      message: "Service temporarily unavailable.",
      status: 503,
    },
  );
});

test("admin fetch classification hides arbitrary exception prose", () => {
  const state = classifyAdminFetchError(
    new Error("provider response included private article text"),
  );

  assert.deepEqual(state, {
    kind: "generic",
    message: "Something went wrong loading this data.",
    status: null,
  });
});

test("admin fetch state keeps authentication branches independent of messages", () => {
  assert.deepEqual(adminFetchErrorState(401, "ignored"), { kind: "unauthorized" });
  assert.deepEqual(adminFetchErrorState(403, "ignored"), { kind: "forbidden" });
});
