import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { lookupWord } from "@/lib/lexical/lookup";
import {
  enforceRateLimitPolicy,
  sessionUserRateLimitPolicy,
} from "@/lib/security/rate-limit/index";
import { recordWordExposure } from "@/lib/learning/word-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { frequencyTier } from "@/lib/frequency";

const DICTIONARY_RATE_LIMIT = sessionUserRateLimitPolicy("lookup");

const bodySchema = object({ word: nonEmptyString(200) });

async function recordDictionaryExposure(userId: string, word: string) {
  // Best-effort: a lookup is a word exposure. Never block the response.
  await bestEffortMastery("dictionary.exposure", () => recordWordExposure(userId, word));
}

async function recordLookupUsage(userId: string, found: boolean) {
  // Product analytics (RW-051): metadata only; never store the word/definition.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.lookup,
    userId,
    properties: { found },
  });
}

export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  await enforceRateLimitPolicy(DICTIONARY_RATE_LIMIT, { session });
  const result = await lookupWord(body.word);
  await recordDictionaryExposure(session.user.id, body.word);
  await recordLookupUsage(session.user.id, result.found);
  return NextResponse.json({ ...result, frequencyTier: frequencyTier(body.word) });
});
