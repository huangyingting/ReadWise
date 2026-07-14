import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { beginRender, getHookRef, runCleanups } from "./support/react-hook-harness";

/**
 * usePlaybackClock — deterministic lifecycle tests.
 *
 * Uses the react-hook-harness which:
 *  - calls useEffect synchronously and captures cleanups
 *  - returns functions directly from useCallback (no memoization)
 *  - manages refs via a cursor array reset between tests
 *
 * Fake rAF infrastructure tracks scheduled callbacks and their ids so we can
 * flush one frame at a time and verify exactly when/what fires.
 */

type FrameEntry = { id: number; cb: () => void };

describe("usePlaybackClock", () => {
  // ── rAF infrastructure ───────────────────────────────────────────────────
  let frames: FrameEntry[];
  let cancelledIds: number[];
  let nextId: number;

  function installFakeRaf(): void {
    frames = [];
    cancelledIds = [];
    nextId = 1;
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void): number => {
      const id = nextId++;
      frames.push({ id, cb });
      return id;
    };
    (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number): void => {
      cancelledIds.push(id);
      frames = frames.filter((f) => f.id !== id);
    };
  }

  /** Run all pending frames (advances one "vsync" batch). */
  function flushFrames(): void {
    const batch = frames.splice(0);
    for (const { cb } of batch) cb();
  }

  // ── Visibility infrastructure ────────────────────────────────────────────
  let visibilityListeners: (() => void)[];
  let hidden: boolean;

  function installFakeDocument(startHidden = false): void {
    hidden = startHidden;
    visibilityListeners = [];
    (globalThis as Record<string, unknown>).document = {
      get hidden(): boolean {
        return hidden;
      },
      addEventListener(type: string, handler: () => void): void {
        if (type === "visibilitychange") visibilityListeners.push(handler);
      },
      removeEventListener(type: string, handler: () => void): void {
        if (type === "visibilitychange") {
          visibilityListeners = visibilityListeners.filter((h) => h !== handler);
        }
      },
    };
  }

  function fireVisibilityChange(nowHidden: boolean): void {
    hidden = nowHidden;
    for (const h of visibilityListeners) h();
  }

  type FakeAudio = { currentTime: number; paused: boolean; ended: boolean };

  function makeAudioRef(
    overrides: { currentTime?: number; paused?: boolean; ended?: boolean } = {},
  ): { current: HTMLAudioElement | null; el: FakeAudio } {
    const el: FakeAudio = {
      currentTime: overrides.currentTime ?? 0,
      paused: overrides.paused ?? false, // playing by default
      ended: overrides.ended ?? false,
    };
    return Object.assign({ current: el as unknown as HTMLAudioElement }, { el });
  }

  // ── beforeEach: install fakes AFTER harness restoreGlobals ───────────────
  beforeEach(() => {
    installFakeRaf();
    installFakeDocument();
  });

  // ────────────────────────────────────────────────────────────────────────
  test("startClock schedules exactly one rAF on first call", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, () => {});

    assert.equal(frames.length, 0, "no rAF before play");
    startClock();
    assert.equal(frames.length, 1, "one rAF after play");
  });

  test("duplicate startClock does not create two rAF loops", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, () => {});

    startClock();
    startClock(); // second call must cancel first, then schedule one new one
    assert.equal(frames.length, 1, "exactly one pending frame after two startClock calls");
  });

  test("tick delivers currentTime to onTick and reschedules for next frame", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ currentTime: 1.5 });
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    assert.equal(frames.length, 1);

    flushFrames();
    assert.deepEqual(ticks, [1.5], "first tick delivers currentTime");
    assert.equal(frames.length, 1, "tick rescheduled itself");

    audioRef.el.currentTime = 2.2;
    flushFrames();
    assert.deepEqual(ticks, [1.5, 2.2], "second tick delivers updated currentTime");
    assert.equal(frames.length, 1, "still rescheduled");
  });

  test("cancelClock stops the loop", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    const ticks: number[] = [];
    beginRender();
    const { startClock, cancelClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    cancelClock();
    assert.equal(frames.length, 0, "cancelled rAF removed from queue");
    flushFrames();
    assert.deepEqual(ticks, [], "no ticks after cancel");
  });

  test("tick exits cleanly when audio is paused mid-loop", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    // Pause audio before the frame fires
    audioRef.el.paused = true;
    flushFrames();

    assert.deepEqual(ticks, [], "paused audio produces no tick");
    assert.equal(frames.length, 0, "loop did not reschedule after pause");
  });

  test("tick exits cleanly when audio has ended", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ ended: true, paused: true });
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    flushFrames();

    assert.deepEqual(ticks, [], "ended audio produces no tick");
    assert.equal(frames.length, 0, "loop did not reschedule after ended");
  });

  test("unmount cleanup cancels the rAF loop", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    assert.equal(frames.length, 1);

    // Simulate unmount
    runCleanups();

    assert.equal(frames.length, 0, "rAF cancelled on unmount");
    flushFrames(); // nothing to flush
    assert.deepEqual(ticks, [], "no ticks after unmount cleanup");
  });

  test("unmount sets mountedRef so any already-fired tick is a no-op", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));
    // Access mountedRef (refs[0]) AFTER the hook has initialized it
    const mountedRef = getHookRef<boolean>(0)!;

    startClock();
    // Simulate component gone without going through cancelClock
    mountedRef.current = false;
    flushFrames();

    assert.deepEqual(ticks, [], "tick is a no-op when mountedRef is false");
    assert.equal(frames.length, 0, "no reschedule after mountedRef=false");
  });

  test("startClock is a no-op when document is hidden (background tab)", async () => {
    installFakeDocument(true); // hidden = true
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, () => {});

    startClock();
    assert.equal(frames.length, 0, "no rAF scheduled when document is hidden");
  });

  test("tick stops when document becomes hidden mid-loop", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ currentTime: 1.0 });
    const ticks: number[] = [];
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    // Page hides before the frame fires
    hidden = true;
    flushFrames();

    assert.deepEqual(ticks, [], "no tick when hidden flag is set");
    assert.equal(frames.length, 0, "loop stops when hidden");
  });

  test("visibilitychange to hidden cancels the rAF loop", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef();
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, () => {});

    startClock();
    assert.equal(frames.length, 1);

    fireVisibilityChange(true); // tab hidden
    assert.equal(frames.length, 0, "rAF cancelled on visibilitychange hidden");
  });

  test("visibilitychange to visible while playing restarts the rAF loop", async () => {
    installFakeDocument(true); // start hidden
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ paused: false });
    beginRender();
    usePlaybackClock(audioRef, () => {});

    // Tab was hidden — no rAF running
    assert.equal(frames.length, 0);

    // Page becomes visible while audio is playing
    fireVisibilityChange(false);
    assert.equal(frames.length, 1, "rAF restarted on visibilitychange visible");
  });

  test("visibilitychange to visible while paused does NOT restart the rAF loop", async () => {
    installFakeDocument(true);
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ paused: true });
    beginRender();
    usePlaybackClock(audioRef, () => {});

    fireVisibilityChange(false);
    assert.equal(frames.length, 0, "no rAF when audio is paused on visible transition");
  });

  test("onTick ref stays current — new handler called after source change race", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ currentTime: 3.0 });
    const firstTicks: number[] = [];
    const secondTicks: number[] = [];

    beginRender();
    const { startClock, cancelClock } = usePlaybackClock(audioRef, (t) =>
      firstTicks.push(t),
    );

    startClock();
    flushFrames(); // delivers to firstTicks
    assert.deepEqual(firstTicks, [3.0]);

    // Simulate source change: cancel clock, update onTickRef with new handler
    cancelClock();
    // onTickRef is refs[2] per hook order: mountedRef(0), rafIdRef(1), onTickRef(2)
    const onTickRef = getHookRef<(t: number) => void>(2)!;
    onTickRef.current = (t) => secondTicks.push(t);

    // Restart with new source
    audioRef.el.currentTime = 7.5;
    startClock();
    flushFrames();

    assert.deepEqual(firstTicks, [3.0], "old handler received only old ticks");
    assert.deepEqual(secondTicks, [7.5], "new handler receives ticks after source change");
  });

  test("visibilitychange listener is removed on cleanup", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ paused: false });
    beginRender();
    usePlaybackClock(audioRef, () => {});

    assert.equal(visibilityListeners.length, 1, "listener registered on mount");

    runCleanups();
    assert.equal(visibilityListeners.length, 0, "listener removed on unmount");
  });

  // ── React Strict Mode regression (REF-030 / #1060) ───────────────────────
  // Strict Mode replays effects as setup → cleanup → setup. Before the fix,
  // the cleanup set mountedRef.current = false and the second setup did not
  // restore it, so every tick exited early and the clock was silently disabled.

  test("Strict Mode replay: clock ticks after setup → cleanup → setup", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ currentTime: 1.5 });
    const ticks: number[] = [];

    // Phase 1 — initial mount (Strict Mode first pass)
    beginRender();
    usePlaybackClock(audioRef, (t) => ticks.push(t));

    // Strict Mode cleanup: runs all effect cleanups
    runCleanups();

    // Phase 2 — remount (Strict Mode second pass — the real mount)
    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    assert.equal(frames.length, 1, "rAF scheduled after Strict Mode replay");

    flushFrames();
    assert.deepEqual(ticks, [1.5], "tick fires after Strict Mode setup → cleanup → setup");
  });

  test("Strict Mode replay: unmount after replay still blocks stale ticks", async () => {
    const { usePlaybackClock } = await import("@/components/reader/usePlaybackClock");
    const audioRef = makeAudioRef({ currentTime: 2.5 });
    const ticks: number[] = [];

    // Simulate Strict Mode double-invoke
    beginRender();
    usePlaybackClock(audioRef, (t) => ticks.push(t));
    runCleanups();

    beginRender();
    const { startClock } = usePlaybackClock(audioRef, (t) => ticks.push(t));

    startClock();
    assert.equal(frames.length, 1, "rAF scheduled after replay");

    // Unmount
    runCleanups();
    assert.equal(frames.length, 0, "rAF cancelled on unmount after replay");

    flushFrames(); // nothing left
    assert.deepEqual(ticks, [], "no ticks fire after unmount following replay");
  });
});
