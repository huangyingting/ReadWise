import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  flushAsyncWork,
} from "./support/react-hook-harness";

type TimerHandle = {
  callback: () => void;
  cleared: boolean;
};

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
  return handles;
}

describe("useFilteredFetch hook behavior", () => {
  test("keeps only the latest result and aborts superseded requests", async () => {
    const { useFilteredFetch } = await import("@/hooks/useFilteredFetch");
    const results: number[] = [];

    let resolveFirst: (value: number) => void = () => {};
    let firstSignal: { aborted?: boolean } = {};
    const firstResponse = new Promise<number>((resolve) => {
      resolveFirst = resolve;
    });

    beginRender();
    const hook = useFilteredFetch<number>(0);
    hook.run({
      fetcher: (signal) => {
        firstSignal = signal;
        return firstResponse;
      },
      onResult: (value) => {
        results.push(value);
      },
    });

    hook.run({
      fetcher: async () => 2,
      onResult: (value) => {
        results.push(value);
      },
    });

    assert.equal(firstSignal.aborted, true);
    resolveFirst(1);
    await flushAsyncWork();

    assert.deepEqual(results, [2]);
  });

  test("swallows AbortError without calling onError", async () => {
    const { useFilteredFetch } = await import("@/hooks/useFilteredFetch");

    beginRender();
    const hook = useFilteredFetch<number>(0);
    let errorCalls = 0;

    hook.run({
      fetcher: async () => {
        throw new DOMException("Aborted", "AbortError");
      },
      onResult: () => {
        assert.fail("AbortError should not deliver results");
      },
      onError: () => {
        errorCalls += 1;
      },
    });
    await flushAsyncWork();

    assert.equal(errorCalls, 0);
  });

  test("cancels pending debounce timers and prevents the fetch from firing", async () => {
    const { useFilteredFetch } = await import("@/hooks/useFilteredFetch");
    const timers = installFakeTimers();
    let fetchCalls = 0;

    beginRender();
    const hook = useFilteredFetch<string>(250);
    hook.run({
      fetcher: async () => {
        fetchCalls += 1;
        return "ok";
      },
      onResult: () => {},
    });

    assert.equal(timers.length, 1);
    hook.cancel();
    assert.equal(timers[0]?.cleared, true);

    for (const timer of timers) {
      if (!timer.cleared) timer.callback();
    }
    await flushAsyncWork();

    assert.equal(fetchCalls, 0);
  });

  test("cancel aborts an in-flight request", async () => {
    const { useFilteredFetch } = await import("@/hooks/useFilteredFetch");

    let signalFromFetcher: { aborted?: boolean } = {};
    let resolveFetcher: (value: string) => void = () => {};
    const response = new Promise<string>((resolve) => {
      resolveFetcher = resolve;
    });

    beginRender();
    const hook = useFilteredFetch<string>(0);
    hook.run({
      fetcher: async (signal) => {
        signalFromFetcher = signal;
        return response;
      },
      onResult: () => {
        assert.fail("cancelled request should not report success");
      },
    });

    hook.cancel();
    assert.equal(signalFromFetcher.aborted, true);

    resolveFetcher("ok");
    await flushAsyncWork();
  });
});
