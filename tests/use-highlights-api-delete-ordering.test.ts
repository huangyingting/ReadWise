import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Ref<T> = { current: T };
type QueueSpec = {
  type: string;
  clientMutationId?: string;
  dependsOnClientMutationId?: string;
};
type SubmitResult = {
  sent: boolean;
  queued: boolean;
  status?: number;
};

const refs: Ref<unknown>[] = [];
let refIndex = 0;
const mutationIds = ["create-old", "delete-old", "create-new"];
const queueSpecs: QueueSpec[] = [];
let resolveDelete!: (result: SubmitResult) => void;

function renderStart(): void {
  refIndex = 0;
}

mock.module("react", {
  namedExports: {
    useCallback: <T>(callback: T) => callback,
    useEffect: () => undefined,
    useRef: <T>(initial: T): Ref<T> => {
      const index = refIndex;
      refIndex += 1;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index] as Ref<T>;
    },
    useState: <T>(initial: T) => [initial, () => undefined],
  },
});

mock.module("@/lib/offline/sync-runtime", {
  namedExports: {
    captureOfflineMutationGeneration: () => ({
      local: 0,
      shared: "generation-1",
    }),
    isOfflineMutationGenerationCurrent: () => true,
    newClientMutationId: () => {
      const id = mutationIds.shift();
      assert.ok(id);
      return id;
    },
    queueMutation: async (spec: QueueSpec): Promise<SubmitResult> => {
      queueSpecs.push(spec);
      if (spec.clientMutationId === "delete-old") {
        return new Promise<SubmitResult>((resolve) => {
          resolveDelete = resolve;
        });
      }
      return { sent: false, queued: true };
    },
    submitMutation: async () => ({ sent: false, queued: true }),
  },
});

test("same-anchor recreation waits while an optimistic delete is being enqueued", async () => {
  let fetchCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    throw new Error("offline");
  });

  const { useHighlightsApi } = await import(
    "@/components/reader/useHighlightsApi"
  );
  const input = {
    quote: "same anchor",
    startOffset: 10,
    endOffset: 21,
  };
  const dispatch = () => undefined;
  const announce = () => undefined;

  renderStart();
  const initialApi = useHighlightsApi({
    articleId: "article-1",
    highlights: [],
    dispatch,
    announce,
  });
  const optimistic = await initialApi.add(input);
  assert.ok(optimistic);
  assert.equal(optimistic.id, "optimistic-create-old");

  renderStart();
  const api = useHighlightsApi({
    articleId: "article-1",
    highlights: [optimistic],
    dispatch,
    announce,
  });
  const deleting = api.remove(optimistic.id);
  await Promise.resolve();

  const recreating = api.add(input);
  await Promise.resolve();
  assert.equal(
    fetchCalls,
    1,
    "recreation must not reach the network before deletion is durably queued",
  );
  assert.equal(queueSpecs.length, 2);

  resolveDelete({ sent: false, queued: true });
  await Promise.all([deleting, recreating]);

  assert.equal(queueSpecs.length, 3);
  assert.equal(queueSpecs[2].type, "highlight.create");
  assert.equal(
    queueSpecs[2].dependsOnClientMutationId,
    "delete-old",
    "recreation must declare the queued deletion as its predecessor",
  );
});
