import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { batchNarrationTextBasis, prepareNarrationText } from "@/lib/speech/text-basis";

export const runtime = "nodejs";

/**
 * Full narration text for on-device synthesis. Uses the same reader-text
 * extraction as stored narration so word offsets map onto the rendered prose.
 * No speech provider is called, so the AI rate limit does not apply.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const { plainText } = prepareNarrationText(article.content, batchNarrationTextBasis(null));
  return NextResponse.json(
    { plainText },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
