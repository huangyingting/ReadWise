import { test } from "node:test";
import assert from "node:assert/strict";

import { beginRender, runCleanups } from "./support/react-hook-harness";

test("remeasures a live ref anchor when layout is rescheduled", async (context) => {
  let anchorTop = 100;
  const anchorElement = {
    getBoundingClientRect: () => ({
      top: anchorTop,
      right: 140,
      bottom: anchorTop + 20,
      left: 100,
    }),
  } as unknown as HTMLElement;
  const anchorRef = { current: anchorElement };
  const style: Record<string, string> = {};
  const floating = {
    dataset: {},
    offsetHeight: 40,
    offsetWidth: 120,
    scrollHeight: 40,
    scrollWidth: 120,
    style,
  } as unknown as HTMLElement;

  const listeners: { scroll?: EventListener } = {};
  const windowStub = {
    innerHeight: 600,
    innerWidth: 800,
    visualViewport: null,
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (type === "scroll") listeners.scroll = listener as EventListener;
    },
    removeEventListener() {},
  } as unknown as Window & typeof globalThis;
  Object.assign(globalThis, { window: windowStub });

  let nextFrame: FrameRequestCallback | null = null;
  const animationGlobals = globalThis as unknown as {
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const originalRequestAnimationFrame = animationGlobals.requestAnimationFrame;
  const originalCancelAnimationFrame = animationGlobals.cancelAnimationFrame;
  animationGlobals.requestAnimationFrame = (callback) => {
    nextFrame = callback;
    return 1;
  };
  animationGlobals.cancelAnimationFrame = () => {
    nextFrame = null;
  };
  context.after(() => {
    if (originalRequestAnimationFrame) {
      animationGlobals.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete animationGlobals.requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      animationGlobals.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete animationGlobals.cancelAnimationFrame;
    }
  });

  function flushFrame() {
    const callback = nextFrame;
    assert.ok(callback);
    nextFrame = null;
    callback(0);
  }

  const { useFloatingPosition } = await import(
    "@/components/ui/useFloatingPosition"
  );
  beginRender();
  useFloatingPosition({ current: floating }, anchorRef, {
    placement: "below",
    align: "start",
    gap: 0,
    viewportPadding: 0,
    flip: false,
  });

  flushFrame();
  assert.equal(style.top, "120px");

  anchorTop = 220;
  assert.ok(listeners.scroll);
  listeners.scroll({ type: "scroll" } as Event);
  flushFrame();
  assert.equal(style.top, "240px");

  runCleanups();
});