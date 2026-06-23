import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { lookupWord } from "@/lib/dictionary";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordWordExposure } from "@/lib/word-mastery";
import { bestEffortMastery } from "@/lib/mastery";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics";

const bodySchema = object({ word: nonEmptyString(200) });

export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  await checkRateLimit(session.user.id, "lookup");
  const result = await lookupWord(body.word);
  // Best-effort: a lookup is a word exposure. Never block the response.
  await bestEffortMastery("dictionary.exposure", () =>
    recordWordExposure(session.user.id, body.word),
  );
  // Product analytics (RW-051): a lookup is a feature-usage signal. Metadata
  // only — the looked-up word/definition is NEVER stored.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.lookup,
    userId: session.user.id,
    properties: { found: result.found },
  });
  return NextResponse.json(result);
});
