import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  flushAsyncWork,
  runCleanups,
} from "./support/react-hook-harness";

type TimerHandle = {
  callback: () => void;
  cleared: boolean;
};

type HookOptions = Parameters<
  typeof import("@/components/flashcard/useReviewSession").useReviewSession
>[0];

const CARD = {
  id: "card-1",
  word: "ephemeral",
  explanation: "Short-lived",
  example: "The moment felt ephemeral.",
  contextSentence: null,
  articleId: null,
};

const CARD2 = {
  ...CARD,
  id: "card-2",
  word: "laconic",
  example: "Her laconic reply ended the discussion.",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installFakeTimers() {
  const handles: TimerHandle[] = [];
  globalThis.setTimeout = ((callback: () => void) => {
    const handle = { callback, cleared: false };
    handles.push(handle);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: TimerHandle) => {
    handle.cleared = true;
  }) as unknown as typeof clearTimeout;

  return {
    handles,
    runPending() {
      for (const handle of handles) {
        if (!handle.cleared) handle.callback();
      }
    },
  };
}

async function importHook() {
  return import("@/components/flashcard/useReviewSession");
}

function useRenderReviewSession(
  useReviewSession: typeof import("@/components/flashcard/useReviewSession").useReviewSession,
  options: HookOptions,
) {
  beginRender();
  return useReviewSession(options);
}

describe("useReviewSession hook behavior", () => {
  test("startSession enters loading, then session, and updates dueCount from flashcard payload", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const phases: string[] = [];
      let starts = 0;
      let ends = 0;

      globalThis.fetch = (async (input) => {
        phases.push(String(input));
        return jsonResponse({ cards: [CARD, CARD2], dueCount: 6 });
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 2,
        announce: () => {},
        onSessionStart: () => starts++,
        onSessionEnd: () => ends++,
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "idle");
      assert.equal(hook.dueCount, 2);

      const startPromise = hook.startSession("flashcard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "loading");

      await startPromise;
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase === "session") {
        assert.equal(hook.appState.mode, "flashcard");
        assert.equal(hook.appState.cards.length, 2);
      }
      assert.equal(hook.dueCount, 6);
      assert.deepEqual(phases, ["/api/study/flashcards"]);
      assert.equal(starts, 1);
      assert.equal(ends, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("startSession handles failure, empty cloze payload, and a successful retry lifecycle", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const urls: string[] = [];
      let call = 0;

      globalThis.fetch = (async (input) => {
        const url = String(input);
        urls.push(url);
        call += 1;
        if (call === 1) return jsonResponse({ error: "boom" }, 500);
        if (call === 2) return jsonResponse({ items: [] });
        return jsonResponse({ cards: [CARD], dueCount: 1 });
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 3,
        announce: () => {},
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      const failed = hook.startSession("flashcard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "loading");
      await failed;
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "idle");
      assert.equal(hook.dueCount, 3);

      const empty = hook.startSession("cloze");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "loading");
      await empty;
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "idle");
      assert.equal(hook.dueCount, 0);

      const retry = hook.startSession("flashcard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "loading");
      await retry;
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      assert.equal(hook.dueCount, 1);
      assert.deepEqual(urls, [
        "/api/study/flashcards",
        "/api/study/cloze",
        "/api/study/flashcards",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("startSession aborts superseded fetches and ignores stale responses during retries", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const firstLoad = deferred<Response>();
      let firstSignal: AbortSignal | undefined;
      let calls = 0;

      globalThis.fetch = (async (_input, init) => {
        calls += 1;
        if (calls === 1) {
          firstSignal = init?.signal as AbortSignal;
          return firstLoad.promise;
        }
        return jsonResponse({ items: [CARD] });
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 9,
        announce: () => {},
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      const firstStart = hook.startSession("flashcard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "loading");

      const secondStart = hook.startSession("cloze");
      assert.equal(firstSignal?.aborted, true);
      await secondStart;
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase === "session") {
        assert.equal(hook.appState.mode, "cloze");
        assert.equal(hook.appState.cards[0]?.id, CARD.id);
      }
      assert.equal(hook.dueCount, 1);

      firstLoad.resolve(jsonResponse({ cards: [CARD2], dueCount: 42 }));
      await firstStart;
      await flushAsyncWork();

      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase === "session") {
        assert.equal(hook.appState.mode, "cloze");
        assert.equal(hook.appState.cards[0]?.id, CARD.id);
      }
      assert.equal(hook.dueCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("startSession aborts in-flight loading when the hook unmounts", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const loading = deferred<Response>();
      let signalFromFetch: AbortSignal | undefined;

      globalThis.fetch = (async (_input, init) => {
        signalFromFetch = init?.signal as AbortSignal;
        signalFromFetch.addEventListener("abort", () => {
          loading.reject(new DOMException("Aborted", "AbortError"));
        });
        return loading.promise;
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 2,
        announce: () => {},
      };

      const hook = useRenderReviewSession(useReviewSession, options);
      const startPromise = hook.startSession("flashcard");
      useRenderReviewSession(useReviewSession, options);
      runCleanups();
      assert.equal(signalFromFetch?.aborted, true);
      await startPromise;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("submitGrade sets optimistic grading before response, sends payload, updates dueCount, and advances with deferred focus callback", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const timers = installFakeTimers();
      const gradeResponse = deferred<Response>();
      const announcements: string[] = [];
      let afterAdvanceCalls = 0;
      const requests: Array<{ url: string; init?: RequestInit }> = [];

      globalThis.fetch = (async (input, init) => {
        requests.push({ url: String(input), init });
        if (requests.length === 1) return jsonResponse({ items: [CARD, CARD2] });
        return gradeResponse.promise;
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 4,
        announce: (message) => announcements.push(message),
        onAfterGradeAdvance: () => afterAdvanceCalls++,
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      await hook.startSession("cloze");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase !== "session") assert.fail("session should be active");

      announcements.length = 0;
      const submitPromise = hook.submitGrade("hard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase !== "session") assert.fail("session should still be active");
      assert.equal(hook.appState.grading, true);
      assert.equal(hook.appState.index, 0);
      assert.equal(afterAdvanceCalls, 0);
      assert.deepEqual(announcements, []);

      assert.equal(requests[1]?.url, "/api/study/flashcards/grade");
      assert.equal(requests[1]?.init?.method, "POST");
      assert.deepEqual(
        requests[1]?.init?.headers,
        { "Content-Type": "application/json" },
      );
      assert.deepEqual(
        JSON.parse(String(requests[1]?.init?.body ?? "{}")),
        { savedWordId: CARD.id, grade: "hard" },
      );

      gradeResponse.resolve(jsonResponse({ dueAt: null, dueCount: 5 }));
      await submitPromise;

      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");
      if (hook.appState.phase !== "session") assert.fail("session should still be active");
      assert.equal(hook.appState.index, 1);
      assert.equal(hook.appState.grading, false);
      assert.equal(hook.appState.flipped, false);
      assert.equal(hook.appState.gradeCounts.hard, 1);
      assert.equal(hook.dueCount, 5);
      assert.deepEqual(announcements, ["Marked hard. Card 2 of 2."]);
      assert.equal(afterAdvanceCalls, 0);
      timers.runPending();
      assert.equal(afterAdvanceCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("submitGrade still advances on network failure without rolling back dueCount", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const announcements: string[] = [];
      let calls = 0;

      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ items: [CARD] });
        throw new Error("network down");
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 7,
        announce: (message) => announcements.push(message),
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      await hook.startSession("cloze");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.dueCount, 1);

      announcements.length = 0;
      await hook.submitGrade("good");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "complete");
      if (hook.appState.phase === "complete") {
        assert.equal(hook.appState.total, 1);
        assert.equal(hook.appState.gradeCounts.good, 1);
      }
      assert.equal(hook.dueCount, 1);
      assert.deepEqual(announcements, ["Session complete."]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("flipCard preserves announcement content and clears deferred focus timers on cleanup", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const timers = installFakeTimers();
      const announcements: string[] = [];
      let afterFlipCalls = 0;

      globalThis.fetch = (async (input) => {
        assert.equal(String(input), "/api/study/flashcards");
        return jsonResponse({ cards: [CARD], dueCount: 1 });
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 2,
        announce: (message) => announcements.push(message),
        onAfterFlip: () => afterFlipCalls++,
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      await hook.startSession("flashcard");
      hook = useRenderReviewSession(useReviewSession, options);
      assert.equal(hook.appState.phase, "session");

      announcements.length = 0;
      hook.flipCard();
      assert.deepEqual(announcements, ["Answer revealed"]);
      assert.equal(afterFlipCalls, 0);
      assert.equal(timers.handles.length, 1);

      runCleanups();
      assert.equal(timers.handles[0]?.cleared, true);
      timers.runPending();
      assert.equal(afterFlipCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("submitClozeAnswer announces correctness and updates cloze submission state", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const { useReviewSession } = await importHook();
      const announcements: string[] = [];

      globalThis.fetch = (async (input) => {
        assert.equal(String(input), "/api/study/cloze");
        return jsonResponse({ items: [CARD] });
      }) as typeof fetch;

      const options: HookOptions = {
        initialDueCount: 2,
        announce: (message) => announcements.push(message),
      };

      let hook = useRenderReviewSession(useReviewSession, options);
      await hook.startSession("cloze");
      hook = useRenderReviewSession(useReviewSession, options);
      if (hook.appState.phase !== "session") assert.fail("session should be active");

      announcements.length = 0;
      hook.submitClozeAnswer("  ephemeral ");
      hook = useRenderReviewSession(useReviewSession, options);
      if (hook.appState.phase !== "session") assert.fail("session should remain active");
      assert.equal(hook.appState.clozeSubmitted, true);
      assert.equal(hook.appState.clozeCorrect, true);
      assert.deepEqual(announcements, ["Correct!"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
