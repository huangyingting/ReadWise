process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: { findUnique: async () => null },
        articleSpeech: { findUnique: async () => null },
      },
    },
  });
  mock.module("@/lib/content-pipeline", {
    namedExports: {
      articleHtmlToReaderText: (html: string) => html,
    },
  });
  mock.module("@/lib/runtime-config/speech", {
    namedExports: {
      DEFAULT_SPEECH_VOICE: "en-US-JennyNeural",
      speechConfig: {
        get: () => null,
        isConfigured: () => false,
      },
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isTtsFeatureEnabled: () => true,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ error: () => {} }),
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      SYSTEM_ARTICLE_CONTEXT: { system: true },
      getAiProcessableArticleById: async () => null,
      isArticleOperator: () => false,
    },
  });
  mock.module("@/lib/speech/provider-azure", {
    namedExports: {
      resolveMimeType: () => "audio/mpeg",
      synthesize: async () => null,
    },
  });
  mock.module("@/lib/speech/repository", {
    namedExports: {
      parseStoredSpeechWords: () => [],
      resolveStoredAudioUrl: async () => null,
      saveSpeechResult: async () => null,
    },
  });
});

test("speech index returns null when a non-operator cannot access the article", async () => {
  const { getOrCreateArticleSpeech, isSpeechConfigured } = await import("@/lib/speech");

  assert.equal(isSpeechConfigured(), false);
  assert.equal(await getOrCreateArticleSpeech("article-1", { userId: "user-1" } as never), null);
});

test("token alignment returns empty alignment for empty tokens or timing pieces", async () => {
  const { buildTokenAlignment } = await import("@/lib/speech/timing-alignment");

  assert.deepEqual(buildTokenAlignment([], [{ word: "hello" }]), {
    alignment: [null],
    spanLengths: [1],
  });
  assert.deepEqual(buildTokenAlignment([{ value: "hello", normalized: "hello" }], [{ word: "   " }]), {
    alignment: [null],
    spanLengths: [1],
  });
});
