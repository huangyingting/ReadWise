import { createLogger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";
import { getMediaStorage } from "@/lib/storage";

const log = createLogger("media");

type MediaAssetStore = Pick<typeof prisma, "mediaAsset">;
type MediaAssetReference = { storageKey: string };

export type ArticleMediaAssetScope = {
  articleId: string;
  kind?: string;
};

export type MediaAssetRetirementOperation =
  | "article-delete"
  | "article-rebuild"
  | "account-delete"
  | "member-delete";

export type PreparedMediaAssetRetirement = {
  retire: (operation: MediaAssetRetirementOperation) => Promise<void>;
};

function articleScopeWhere(scope: ArticleMediaAssetScope) {
  return {
    articleId: scope.articleId,
    ...(scope.kind ? { kind: scope.kind } : {}),
  };
}

function prepareRetirement(
  assets: MediaAssetReference[],
): PreparedMediaAssetRetirement {
  let completed = false;
  return {
    async retire(operation) {
      if (completed || assets.length === 0) return;
      completed = true;

      const storage = getMediaStorage();
      if (!storage) return;

      const results = await Promise.allSettled(
        assets.map(({ storageKey }) => storage.delete(storageKey)),
      );
      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount > 0) {
        log.error("media.asset_retirement_failed", {
          failedCount,
          operation,
        });
      }
    },
  };
}

export async function prepareArticleMediaAssetRetirement(
  db: MediaAssetStore,
  scope: ArticleMediaAssetScope,
): Promise<PreparedMediaAssetRetirement> {
  const assets = await db.mediaAsset.findMany({
    where: articleScopeWhere(scope),
    select: { storageKey: true },
  });
  return prepareRetirement(assets);
}

export async function prepareOwnedArticleMediaAssetRetirement(
  ownerId: string,
): Promise<PreparedMediaAssetRetirement> {
  const assets = await prisma.mediaAsset.findMany({
    where: { article: { ownerId } },
    select: { storageKey: true },
  });
  return prepareRetirement(assets);
}

export async function deleteArticleMediaAssetRecords(
  db: MediaAssetStore,
  scope: ArticleMediaAssetScope,
): Promise<void> {
  await db.mediaAsset.deleteMany({ where: articleScopeWhere(scope) });
}