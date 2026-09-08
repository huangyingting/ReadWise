process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type State = {
  claimStatus: string | null;
  translationLangs: string[];
  cleared: boolean;
  jobEnqueued: boolean;
};

type Tx = ReturnType<typeof transactionClient>;

let state: State;
let enqueueFails = false;

function transactionClient(draft: State) {
  const deleteMany = async () => ({ count: 0 });
  return {
    draft,
    translation: {
      findMany: async () =>
        draft.translationLangs.map((targetLang) => ({ targetLang })),
      deleteMany: async () => {
        draft.translationLangs = [];
        draft.cleared = true;
        return { count: 1 };
      },
    },
    sentenceTranslation: { deleteMany },
    vocabularyItem: { deleteMany },
    quizQuestion: { deleteMany },
    articleTag: { deleteMany },
    grammarExplanation: { deleteMany },
    articleSpeech: { deleteMany },
    article: { update: async () => ({}) },
    articleProcessingStep: {
      upsert: async () => {
        if (draft.claimStatus === null) draft.claimStatus = "running";
        return { status: draft.claimStatus };
      },
      deleteMany,
      update: async () => {
        draft.claimStatus = "generated";
        return { status: "generated" };
      },
    },
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $transaction: async (operation: (tx: Tx) => Promise<unknown>) => {
          const draft = structuredClone(state);
          const result = await operation(transactionClient(draft));
          state = draft;
          return result;
        },
      },
    },
  });
  mock.module("@/lib/jobs", {
    namedExports: {
      enqueueAiRebuildInTx: async (tx: Tx) => {
        if (enqueueFails) throw new Error("enqueue unavailable");
        tx.draft.jobEnqueued = true;
        return {};
      },
    },
  });
});

beforeEach(() => {
  state = {
    claimStatus: null,
    translationLangs: ["es", "fr"],
    cleared: false,
    jobEnqueued: false,
  };
  enqueueFails = false;
});

test("derived regeneration rolls back invalidation and claim when enqueue fails", async () => {
  const { requestDerivedRegeneration } = await import(
    "@/lib/scraper/incremental/derived-regeneration"
  );
  enqueueFails = true;

  await assert.rejects(
    requestDerivedRegeneration({
      articleId: "article-1",
      versionId: "version-1",
    }),
    /enqueue unavailable/,
  );
  assert.deepEqual(state, {
    claimStatus: null,
    translationLangs: ["es", "fr"],
    cleared: false,
    jobEnqueued: false,
  });

  enqueueFails = false;
  const result = await requestDerivedRegeneration({
    articleId: "article-1",
    versionId: "version-1",
  });
  assert.deepEqual(result, {
    requested: true,
    alreadyRequested: false,
    translateLangs: ["es", "fr"],
  });
  assert.equal(state.claimStatus, "generated");
  assert.equal(state.cleared, true);
  assert.equal(state.jobEnqueued, true);
});
