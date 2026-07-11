import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary/service";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { frequencyTier } from "@/lib/frequency";

type ArticleVocabulary = NonNullable<Awaited<ReturnType<typeof getOrCreateArticleVocabulary>>>;

function withFrequencyTiers(result: ArticleVocabulary) {
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      frequencyTier: frequencyTier(item.word),
    })),
  };
}

export const POST = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    const result = await getOrCreateArticleVocabulary(params.id, session.user.id, context);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    // Annotate each vocabulary item with its server-computed frequency tier.
    // @/lib/frequency is SERVER-ONLY (imports heavy word-frequency-data); it
    // must never move into client-side code.
    return NextResponse.json(withFrequencyTiers(result));
  },
);
