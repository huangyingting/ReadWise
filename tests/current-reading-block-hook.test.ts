import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  getHookState,
  popHookCleanup,
} from "./support/react-hook-harness";

describe("useCurrentReadingBlock hook behavior", () => {
  function installFakeTimers() {
    type TimerHandle = { callback: () => void; cleared: boolean };
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
      runAll() {
        for (const handle of handles.splice(0)) {
          if (!handle.cleared) handle.callback();
        }
      },
    };
  }

  test("falls back gracefully without a container or IntersectionObserver", async () => {
    const { useCurrentReadingBlock } = await import(
      "@/components/reader/useCurrentReadingBlock"
    );

    beginRender();
    assert.equal(useCurrentReadingBlock(null), null);

    beginRender();
    assert.equal(
      useCurrentReadingBlock({
        querySelectorAll: () => [],
      } as unknown as HTMLElement),
      null,
    );
  });

  test("observes block tags, debounces updates, avoids duplicate state, and cleans up", async () => {
    const { useCurrentReadingBlock } = await import(
      "@/components/reader/useCurrentReadingBlock"
    );
    const timers = installFakeTimers();
    const short = { tagName: "P", textContent: "short" };
    const best = {
      tagName: "H2",
      textContent: "This heading has enough text to count.",
    };
    const filtered = {
      tagName: "DIV",
      textContent: "This div should not be observed.",
    };
    const container = {
      querySelectorAll: () => [short, best, filtered],
    } as unknown as HTMLElement;
    let callback: (
      entries: Array<{ target: Element; intersectionRatio: number }>
    ) => void = () => assert.fail("observer callback was not installed");
    const observed: Element[] = [];
    let disconnected = false;

    class FakeIntersectionObserver {
      readonly options: IntersectionObserverInit;

      constructor(
        cb: (entries: Array<{ target: Element; intersectionRatio: number }>) => void,
        options: IntersectionObserverInit,
      ) {
        callback = cb;
        this.options = options;
        assert.ok(Array.isArray(options.threshold));
        assert.equal(options.threshold.length, 21);
      }

      observe(el: Element) {
        observed.push(el);
      }

      disconnect() {
        disconnected = true;
      }
    }

    Object.assign(globalThis, {
      IntersectionObserver: FakeIntersectionObserver,
    });

    beginRender();
    assert.equal(useCurrentReadingBlock(container), null);
    assert.deepEqual(observed, [short, best]);

    callback([
      { target: short as unknown as Element, intersectionRatio: 1 },
      { target: best as unknown as Element, intersectionRatio: 0.4 },
    ]);
    timers.runAll();
    const firstBlock = getHookState<{
      index: number;
      text: string;
      ratio: number;
    }>(0);
    assert.ok(firstBlock);
    assert.equal(firstBlock.index, 1);
    assert.equal(firstBlock.ratio, 0.4);

    callback([{ target: best as unknown as Element, intersectionRatio: 0.4 }]);
    timers.runAll();
    assert.equal(getHookState(0), firstBlock);

    callback([{ target: best as unknown as Element, intersectionRatio: 0 }]);
    timers.runAll();
    assert.equal(getHookState(0), null);

    callback([{ target: best as unknown as Element, intersectionRatio: 0.7 }]);
    const cleanup = popHookCleanup();
    cleanup?.();

    assert.equal(disconnected, true);
    assert.equal(timers.handles.at(-1)?.cleared, true);
    assert.equal(getHookState(0), null);
  });
});
