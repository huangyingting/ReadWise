/**
 * Behavior of the reader highlights API adapter across online, offline-queued,
 * failed, and stale-session paths. React, the offline sync runtime, and fetch
 * are scripted so each branch runs deterministically without a DOM.
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

type Ref<T> = { current: T };
type Result = { sent: boolean; queued: boolean; status?: number };
type Call = Record<string, unknown> & { type: string };
type Highlight = {
  id: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
};

let refs: Ref<unknown>[] = [];
let refIndex = 0;
let effectDeps: unknown[][] = [];
let effectIndex = 0;
let effectCleanups: Array<() => void> = [];
let loadingUpdates: boolean[] = [];

let actorId: string | null = "user-1";
let generationCurrent = true;
let mutationCounter = 0;
let queueResult: Result = { sent: false, queued: true };
let submitResult: Result = { sent: false, queued: true };
let queueCalls: Call[] = [];
let submitCalls: Call[] = [];
let fetchResponses: Array<Response | Error> = [];
// One fetch mock for the file; tests swap the implementation (restoreAll would
// also undo the module mocks above).
let fetchImpl: () => Promise<Response> = () => nextFetch();
mock.method(globalThis, "fetch", () => fetchImpl());

mock.module("react", {
  namedExports: {
    useCallback: <T>(callback: T) => callback,
    // Like React: run on mount and again only when a dependency changes.
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const index = effectIndex;
      effectIndex += 1;
      const previous = effectDeps[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous[i]))) return;
      effectDeps[index] = deps;
      const cleanup = effect();
      if (cleanup) effectCleanups.push(cleanup);
    },
    useRef: <T>(initial: T): Ref<T> => {
      const index = refIndex;
      refIndex += 1;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index] as Ref<T>;
    },
    useState: <T>(initial: T) => [
      initial,
      (value: T) => loadingUpdates.push(value as unknown as boolean),
    ],
  },
});

mock.module("@/lib/offline/sync-runtime", {
  namedExports: {
    captureOfflineMutationGeneration: () => ({ local: 0, shared: "gen-1", actorId }),
    isOfflineMutationGenerationCurrent: () => generationCurrent,
    newClientMutationId: () => `m${(mutationCounter += 1)}`,
    queueMutation: async (spec: Call) => {
      queueCalls.push(spec);
      return queueResult;
    },
    submitMutation: async (spec: Call) => {
      submitCalls.push(spec);
      return submitResult;
    },
  },
});

function nextFetch(): Promise<Response> {
  const next = fetchResponses.shift();
  if (next instanceof Error) return Promise.reject(next);
  return Promise.resolve(next ?? new Response("{}", { status: 500 }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "h1",
    quote: "quote",
    startOffset: 1,
    endOffset: 6,
    prefix: "",
    suffix: "",
    note: null,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const INPUT = { quote: "quote", startOffset: 1, endOffset: 6 };

beforeEach(() => {
  refs = [];
  effectDeps = [];
  effectCleanups = [];
  loadingUpdates = [];
  actorId = "user-1";
  generationCurrent = true;
  mutationCounter = 0;
  queueResult = { sent: false, queued: true };
  submitResult = { sent: false, queued: true };
  queueCalls = [];
  submitCalls = [];
  fetchResponses = [];
  fetchImpl = () => nextFetch();
});

/** Mounts the hook as one component instance; `render` re-renders it with new highlights. */
async function mount(
  initialLoad: Response | Error = json({ highlights: [] }),
  { keepLoadEffects = false } = {},
) {
  const dispatched: Array<Record<string, unknown>> = [];
  const announced: string[] = [];
  // React is mocked, so the hook runs as a plain function; the alias keeps the
  // rules-of-hooks lint from treating this harness as a component.
  const { useHighlightsApi: runHighlightsApi } = await import("@/components/reader/useHighlightsApi");
  // Stable across renders, as the provider's dispatch/announce are.
  const dispatch = (action: unknown) => dispatched.push(action as Record<string, unknown>);
  const announce = (message: string) => announced.push(message);
  effectDeps = [];
  fetchResponses.unshift(initialLoad);
  const render = (highlights: Highlight[] = []) => {
    refIndex = 0;
    effectIndex = 0;
    return runHighlightsApi({
      articleId: "a1",
      highlights: highlights as never,
      dispatch,
      announce,
    });
  };
  const api = render();
  await new Promise((resolve) => setImmediate(resolve));
  if (!keepLoadEffects) dispatched.length = 0;
  return { api, render, dispatched, announced };
}

test("initial load replaces highlights, degrades silently, and ignores late results after unmount", async () => {
  const loaded = await mount(json({ highlights: [highlight()] }), { keepLoadEffects: true });
  assert.deepEqual(loaded.dispatched, [{ type: "SET", highlights: [highlight()] }]);
  assert.deepEqual(loadingUpdates, [true, false]);

  loadingUpdates = [];
  const failed = await mount(new Response("nope", { status: 503 }), { keepLoadEffects: true });
  assert.deepEqual(failed.dispatched, []);
  assert.deepEqual(loadingUpdates, [true, false]);

  loadingUpdates = [];
  effectCleanups = [];
  let release!: (response: Response) => void;
  fetchResponses = [];
  fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });
  const { useHighlightsApi } = await import("@/components/reader/useHighlightsApi");
  const dispatched: unknown[] = [];
  refIndex = 0;
  effectIndex = 0;
  effectDeps = [];
  useHighlightsApi({ articleId: "a1", highlights: [], dispatch: (a: unknown) => dispatched.push(a), announce: () => {} });
  effectCleanups.forEach((cleanup) => cleanup());
  release(json({ highlights: [highlight()] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched, []);
  assert.deepEqual(loadingUpdates, [true]);
});

test("add confirms online, reverts on server or session failure, and queues offline", async () => {
  const { api, dispatched, announced } = await mount();

  fetchResponses.push(json({ highlight: highlight({ id: "real-1" }) }));
  assert.equal((await api.add(INPUT))?.id, "real-1");
  assert.equal(dispatched.at(-1)?.type, "REPLACE_OPTIMISTIC");
  assert.equal(announced.at(-1), "Highlight added");

  fetchResponses.push(new Response("bad", { status: 400 }));
  assert.equal(await api.add(INPUT), null);
  assert.equal(dispatched.at(-1)?.type, "REVERT_OPTIMISTIC");
  assert.equal(announced.at(-1), "Failed to save highlight");

  actorId = null;
  assert.equal(await api.add(INPUT), null);
  assert.equal(announced.at(-1), "Failed to save highlight");
  actorId = "user-1";
  generationCurrent = false;
  assert.equal(await api.add(INPUT), null);
  generationCurrent = true;

  fetchResponses.push(new Error("offline"));
  const queued = await api.add(INPUT);
  assert.match(queued?.id ?? "", /^optimistic-/);
  assert.equal(announced.at(-1), "Highlight saved offline");

  queueResult = { sent: false, queued: false };
  fetchResponses.push(new Error("offline"));
  assert.equal(await api.add(INPUT), null);
  assert.equal(announced.at(-1), "Failed to save highlight offline");
});

test("add proceeds online when a same-anchor deletion could not be queued", async () => {
  const { api, render, announced } = await mount();
  fetchResponses.push(new Error("offline"));
  const optimistic = (await api.add(INPUT)) as Highlight;

  queueResult = { sent: false, queued: false };
  await render([optimistic]).remove(optimistic.id);
  assert.equal(announced.at(-1), "Failed to delete offline highlight");

  fetchResponses.push(json({ highlight: highlight({ id: "real-2" }) }));
  assert.equal((await render([]).add(INPUT))?.id, "real-2");
});

test("updateColor covers optimistic, online, offline, and failure paths", async () => {
  const { api, render, dispatched, announced } = await mount();
  const real = highlight({ id: "real", color: "yellow" });

  await render([]).updateColor("missing", "blue");
  assert.equal(dispatched.length, 0);

  await render([highlight({ id: "optimistic-orphan" })]).updateColor("optimistic-orphan", "blue");
  assert.equal(announced.at(-1), "Failed to save highlight color offline");

  fetchResponses.push(new Error("offline"));
  const optimistic = (await api.add(INPUT)) as Highlight;
  await render([optimistic]).updateColor(optimistic.id, "blue");
  assert.deepEqual(queueCalls.at(-1)?.body, { startOffset: 1, endOffset: 6, color: "blue" });
  queueResult = { sent: false, queued: false };
  await render([optimistic]).updateColor(optimistic.id, "pink");
  assert.deepEqual(dispatched.at(-1), { type: "UPDATE", id: optimistic.id, patch: { color: "yellow" } });
  queueResult = { sent: false, queued: true };

  actorId = null;
  await render([real]).updateColor("real", "blue");
  assert.equal(announced.at(-1), "Failed to save highlight color");
  actorId = "user-1";

  fetchResponses.push(json({ highlight: { ...real, color: "blue" } }));
  await render([real]).updateColor("real", "blue");
  assert.deepEqual(dispatched.at(-1), { type: "UPDATE", id: "real", patch: { ...real, color: "blue" } });

  fetchResponses.push(new Response("down", { status: 500 }));
  await render([real]).updateColor("real", "green");
  assert.equal(submitCalls.at(-1)?.dedupeKey, "hl-color:real");

  submitResult = { sent: false, queued: false };
  fetchResponses.push(new Error("offline"));
  await render([real]).updateColor("real", "pink");
  assert.deepEqual(dispatched.at(-1), { type: "UPDATE", id: "real", patch: { color: "yellow" } });
  assert.equal(announced.at(-1), "Failed to save highlight color offline");
});

test("updateNote covers optimistic, merge, offline, and failure paths", async () => {
  const { api, render, announced } = await mount();
  const real = highlight({ id: "real", note: "before" });

  assert.equal(await render([]).updateNote("missing", "x"), false);
  assert.equal(await render([highlight({ id: "optimistic-orphan" })]).updateNote("optimistic-orphan", "x"), false);
  assert.equal(announced.at(-1), "Failed to save note offline");

  fetchResponses.push(new Error("offline"));
  const optimistic = (await api.add({ ...INPUT, note: "draft" })) as Highlight;
  assert.equal(await render([optimistic]).updateNote(optimistic.id, "edited"), true);
  assert.deepEqual(queueCalls.at(-1)?.body, { startOffset: 1, endOffset: 6, note: "edited", baseNote: "draft" });
  queueResult = { sent: false, queued: false };
  assert.equal(await render([optimistic]).updateNote(optimistic.id, "again"), false);
  queueResult = { sent: false, queued: true };

  generationCurrent = false;
  assert.equal(await render([real]).updateNote("real", "x"), false);
  assert.equal(announced.at(-1), "Failed to save note");
  generationCurrent = true;

  fetchResponses.push(json({ highlight: { ...real, note: "merged" }, conflict: true }));
  assert.equal(await render([real]).updateNote("real", "mine"), true);
  assert.match(announced.at(-1) ?? "", /Note merged/);
  fetchResponses.push(json({ highlight: { ...real, note: "mine" } }));
  assert.equal(await render([real]).updateNote("real", "mine"), true);
  assert.equal(announced.at(-1), "Note saved");

  for (const [result, message] of [
    [{ sent: true, queued: false }, "Note saved"],
    [{ sent: false, queued: true }, "Note saved offline"],
  ] as const) {
    submitResult = result;
    fetchResponses.push(new Error("offline"));
    assert.equal(await render([real]).updateNote("real", "queued"), true);
    assert.equal(announced.at(-1), message);
  }
  assert.deepEqual(submitCalls.at(-1)?.body, { note: "queued", baseUpdatedAt: real.updatedAt });

  submitResult = { sent: false, queued: false };
  fetchResponses.push(new Response("down", { status: 500 }));
  assert.equal(await render([real]).updateNote("real", "lost"), false);
  assert.equal(announced.at(-1), "Failed to save note offline");
});

test("remove covers optimistic, replacement, online, offline, and failure paths", async () => {
  const { api, render, dispatched, announced } = await mount();
  const real = highlight({ id: "real" });

  await render([]).remove("missing");
  assert.equal(dispatched.length, 0);

  await render([highlight({ id: "optimistic-orphan" })]).remove("optimistic-orphan");
  assert.equal(announced.at(-1), "Failed to delete offline highlight");

  fetchResponses.push(new Error("offline"));
  const optimistic = (await api.add(INPUT)) as Highlight;
  await render([optimistic]).remove(optimistic.id);
  assert.equal(announced.at(-1), "Highlight deleted offline");

  // Replacing a persisted highlight with a still-queued create orders the delete after it.
  fetchResponses.push(new Error("offline"));
  const replacement = (await api.add({ ...INPUT, startOffset: 20, endOffset: 25 })) as Highlight;
  await render([real, replacement]).remove("real", { dependsOnHighlightId: replacement.id });
  assert.equal(announced.at(-1), "Highlight deletion saved offline");
  assert.equal(queueCalls.at(-1)?.dependsOnClientMutationId, queueCalls.at(-2)?.clientMutationId);
  queueResult = { sent: false, queued: false };
  await render([real, replacement]).remove("real", { dependsOnHighlightId: replacement.id });
  assert.equal(announced.at(-1), "Failed to save highlight deletion offline");
  queueResult = { sent: false, queued: true };

  for (const [result, message] of [
    [{ sent: true, queued: false }, "Highlight deleted"],
    [{ sent: false, queued: true }, "Highlight deleted offline"],
    [{ sent: false, queued: false }, "Failed to delete highlight offline"],
  ] as const) {
    submitResult = result;
    await render([real]).remove("real");
    assert.equal(announced.at(-1), message);
  }
  assert.deepEqual(dispatched.at(-1), { type: "ADD_OPTIMISTIC", optimistic: real });
});
