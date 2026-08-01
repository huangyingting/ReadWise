import { test } from "node:test";
import assert from "node:assert/strict";

import { beginRender, runCleanups } from "./support/react-hook-harness";

test("inactive and unresolved anchors schedule no layout work", async () => {
  const { useFloatingPosition } = await import(
    "@/components/ui/useFloatingPosition"
  );
  const floating = { current: {} as HTMLElement };

  beginRender();
  useFloatingPosition(floating, { x: 10, y: 20 }, {
    active: false,
    placement: "below",
  });

  beginRender();
  useFloatingPosition(floating, { current: null }, { placement: "below" });

  beginRender();
  useFloatingPosition({ current: null }, { x: 10, y: 20 }, { placement: "below" });
});

test("point anchors honor visual viewport, token spacing, size caps, and cleanup", async (context) => {
  const originalGlobals = {
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  context.after(() => {
    for (const [key, value] of Object.entries(originalGlobals)) {
      if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        (globalThis as Record<string, unknown>)[key] = value;
      }
    }
  });

  const windowListeners = new Map<string, EventListener>();
  const viewportListeners = new Map<string, EventListener>();
  const removedWindowListeners: string[] = [];
  const removedViewportListeners: string[] = [];
  const visualViewport = {
    offsetLeft: 10,
    offsetTop: 20,
    width: 320,
    height: 240,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      viewportListeners.set(type, listener as EventListener);
    },
    removeEventListener: (type: string) => {
      removedViewportListeners.push(type);
    },
  } as unknown as VisualViewport;

  const root = {} as HTMLElement;
  let floating: HTMLElement;
  const computedStyle = (element: Element) => {
    if (element === root) {
      return { fontSize: "10px", getPropertyValue: () => "" };
    }
    if (element === floating) {
      return {
        maxHeight: "none",
        maxWidth: "90px",
        getPropertyValue: (property: string) => {
          if (property === "--space-2") return "4px";
          if (property === "--space-3") return "6px";
          if (property === "--safe-top") return "1rem";
          return "";
        },
      };
    }
    return { fontSize: "10px", getPropertyValue: () => "" };
  };
  const windowStub = {
    innerHeight: 600,
    innerWidth: 800,
    visualViewport,
    getComputedStyle: computedStyle,
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      windowListeners.set(type, listener as EventListener);
    },
    removeEventListener(type: string) {
      removedWindowListeners.push(type);
    },
  } as unknown as Window & typeof globalThis;
  Object.assign(globalThis, { window: windowStub, getComputedStyle: computedStyle });

  const ownerDocument = {
    defaultView: windowStub,
    documentElement: root,
  } as unknown as Document;
  const style: Record<string, string> = {};
  floating = {
    dataset: {},
    offsetHeight: 120,
    offsetWidth: 160,
    ownerDocument,
    scrollHeight: 140,
    scrollWidth: 180,
    style,
  } as unknown as HTMLElement;

  let observerCallback: ResizeObserverCallback | null = null;
  const observed: Element[] = [];
  let disconnected = false;
  class ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
      observerCallback = callback;
    }
    observe(element: Element) {
      observed.push(element);
    }
    unobserve() {}
    disconnect() {
      disconnected = true;
    }
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });

  const frames = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  let nextFrameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    frames.set(nextFrameId, callback);
    return nextFrameId;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
    frames.delete(id);
  };

  const { useFloatingPosition } = await import(
    "@/components/ui/useFloatingPosition"
  );
  beginRender();
  useFloatingPosition({ current: floating }, { x: 120, y: 100 }, {
    placement: "below",
    align: "center",
    safeArea: {
      top: { cssVariable: "--safe-top", fallback: 7 },
      right: 2,
      bottom: 3,
      left: 4,
    },
    constrainSize: true,
    matchAnchorWidth: true,
  });

  assert.deepEqual(observed, [floating]);
  assert.equal(frames.size, 0, "initial layout does not wait for an animation frame");
  assert.equal(style.width, "0px");
  assert.match(style.left, /px$/);
  assert.match(style.top, /px$/);
  assert.match(style.maxHeight, /px$/);
  assert.match(style.maxWidth, /px$/);
  assert.ok((floating.dataset.floatingPlacement ?? "").length > 0);

  assert.ok(observerCallback);
  (observerCallback as ResizeObserverCallback)([], {} as ResizeObserver);
  assert.deepEqual(cancelled, []);
  const scheduled = frames.get(1);
  assert.ok(scheduled);
  frames.delete(1);
  scheduled(0);

  const viewportResize = viewportListeners.get("resize");
  assert.ok(viewportResize);
  viewportResize({ type: "resize" } as Event);
  assert.equal(frames.has(2), true);

  runCleanups();
  assert.equal(disconnected, true);
  assert.deepEqual(cancelled, [2]);
  assert.deepEqual(removedWindowListeners.sort(), ["orientationchange", "resize", "scroll"]);
  assert.deepEqual(removedViewportListeners.sort(), ["resize", "scroll"]);
});

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

  assert.equal(style.top, "120px");

  anchorTop = 220;
  assert.ok(listeners.scroll);
  listeners.scroll({ type: "scroll" } as Event);
  flushFrame();
  assert.equal(style.top, "240px");

  runCleanups();
});
