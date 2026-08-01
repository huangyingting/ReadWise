import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";

type RequestCall = {
  url: string;
  init: RequestInit;
};

type QueuedSpec = {
  type: string;
  endpoint: string;
  method?: string;
  body?: unknown;
  clientMutationId?: string;
  dedupeKey?: string;
};

class MockApiResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let online = true;
let responseBody: unknown;
let requestError: Error | null;
let requestCalls: RequestCall[];
let queuedSpecs: QueuedSpec[];
let allowPayload = true;

before(async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      get onLine() {
        return online;
      },
    },
  });

  mock.module("@/lib/client-fetch", {
    namedExports: {
      ApiResponseError: MockApiResponseError,
      requestJson: async (url: string, init: RequestInit) => {
        requestCalls.push({ url, init });
        if (requestError) throw requestError;
        return responseBody;
      },
    },
  });

  mock.module("@/lib/offline/sync-runtime", {
    namedExports: {
      MUTATION_HEADER: "x-client-mutation-id",
      queueMutation: async (spec: QueuedSpec) => {
        queuedSpecs.push(spec);
        return { sent: false, queued: true };
      },
      submitMutation: async () => ({ sent: false, queued: true }),
    },
  });

  const registry = await import("@/lib/offline/registry");
  mock.module("@/lib/offline/registry", {
    namedExports: {
      ...registry,
      isAllowedTodayPayload: (payload: Record<string, unknown>) =>
        allowPayload && registry.isAllowedTodayPayload(payload),
    },
  });
});

after(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

beforeEach(() => {
  online = true;
  responseBody = null;
  requestError = null;
  requestCalls = [];
  queuedSpecs = [];
  allowPayload = true;
});

test("Today action delivery selects HTTP or queue without leaking adapter choice", async () => {
  const { submitTodayAction } = await import("@/lib/offline/today-client");
  const context = {
    userId: "user-1",
    localDate: "2026-07-18",
    timezone: "UTC",
  };

  responseBody = { limitReached: true };
  const delivered = await submitTodayAction(context, {
    type: "today.skip",
    skipReason: "too_busy",
  });

  assert.deepEqual(delivered, {
    kind: "delivered",
    result: { limitReached: true },
  });
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0].url, "/api/today/skip");
  assert.deepEqual(JSON.parse(String(requestCalls[0].init.body)), {
    skipReason: "too_busy",
    timezone: "UTC",
  });
  assert.equal(
    (requestCalls[0].init.headers as Record<string, string>)["x-client-mutation-id"],
    "today-skip-user-1-2026-07-18",
  );
  assert.equal(queuedSpecs.length, 0);

  online = false;
  const queued = await submitTodayAction(context, {
    type: "today.comprehension",
    selfRating: "partial",
    questionId: "question-1",
    selectedIndex: 2,
  });

  assert.deepEqual(queued, { kind: "queued" });
  assert.equal(requestCalls.length, 1);
  assert.deepEqual(queuedSpecs, [
    {
      type: "today.comprehension",
      endpoint: "/api/today/comprehension",
      method: "POST",
      body: {
        localDate: "2026-07-18",
        timezone: "UTC",
        selfRating: "partial",
        questionId: "question-1",
        selectedIndex: 2,
      },
      clientMutationId: "today-comp-user-1-2026-07-18",
      dedupeKey: "today-comp-user-1-2026-07-18",
    },
  ]);
});

test("Today action delivery queues transient failures once and preserves permanent errors", async () => {
  const { submitTodayAction } = await import("@/lib/offline/today-client");
  const context = {
    userId: "user-2",
    localDate: "2026-07-18",
    timezone: "America/Toronto",
  };

  requestError = new MockApiResponseError(503, "Try later");
  assert.deepEqual(
    await submitTodayAction(context, { type: "today.read-complete" }),
    { kind: "queued" },
  );
  assert.equal(requestCalls.length, 1);
  assert.deepEqual(queuedSpecs, [
    {
      type: "today.read-complete",
      endpoint: "/api/today/read-complete",
      method: "POST",
      body: {
        localDate: "2026-07-18",
        timezone: "America/Toronto",
      },
      clientMutationId: "today-read-user-2-2026-07-18",
      dedupeKey: "today-read-user-2-2026-07-18",
    },
  ]);

  requestError = new MockApiResponseError(400, "Invalid action");
  await assert.rejects(
    submitTodayAction(context, { type: "today.word-review-complete" }),
    (error: unknown) =>
      error instanceof MockApiResponseError &&
      error.status === 400 &&
      error.message === "Invalid action",
  );
  assert.equal(requestCalls.length, 2);
  assert.equal(queuedSpecs.length, 1);
});

test("Today action delivery rejects invalid context and disallowed payloads before I/O", async () => {
  const { submitTodayAction } = await import("@/lib/offline/today-client");
  const context = {
    userId: "user-3",
    localDate: "2026-07-18",
    timezone: "UTC",
  };

  await assert.rejects(
    submitTodayAction({ ...context, localDate: "2026-02-30" }, { type: "today.read-complete" }),
    /Invalid Today action local date/,
  );
  await assert.rejects(
    submitTodayAction({ ...context, timezone: "Private/Secret" }, { type: "today.read-complete" }),
    /Invalid Today action timezone/,
  );

  allowPayload = false;
  await assert.rejects(
    submitTodayAction(context, { type: "today.word-review-complete" }),
    /Disallowed field in Today action payload/,
  );
  assert.deepEqual(requestCalls, []);
  assert.deepEqual(queuedSpecs, []);
});
