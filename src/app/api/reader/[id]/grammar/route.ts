import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, object, nonEmptyString, optional, string } from "@/lib/validation";
import { explainGrammar, MAX_PHRASE_CHARS, MAX_CONTEXT_CHARS } from "@/lib/grammar";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { recordSkillEvidence } from "@/lib/skill-mastery";
import { bestEffortMastery } from "@/lib/mastery";

const bodySchema = object({
  phrase: nonEmptyString(MAX_PHRASE_CHARS),
  contextSentence: optional(string({ max: MAX_CONTEXT_CHARS })),
});

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const { article } = await requireReadableArticleForAI(params.id, session.user);

    const result = await explainGrammar(
      params.id,
      body.phrase,
      body.contextSentence ?? "",
      article.difficulty ?? "B1",
    );

    // Best-effort: engaging with grammar help is mild grammar-skill evidence.
    await bestEffortMastery("grammar.skill", () =>
      recordSkillEvidence(session.user.id, "grammar", 0.5, 0.3),
    );

    return NextResponse.json(result);
  },
);
