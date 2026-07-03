import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { explainGrammar } from "@/lib/grammar";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { grammarBody } from "@/lib/reader/schemas";

const DEFAULT_CONTEXT_SENTENCE = "";
const DEFAULT_ARTICLE_DIFFICULTY = "B1";

async function recordGrammarPractice(userId: string) {
  // Best-effort: engaging with grammar help is mild grammar-skill evidence.
  await bestEffortMastery("grammar.skill", () =>
    recordSkillEvidence(userId, "grammar", 0.5, 0.3),
  );
}

export const POST = createHandler(
  { params: idParams, body: grammarBody },
  async ({ params, body, session }) => {
    const { article } = await requireReadableArticleForAI(params.id, session.user);

    const result = await explainGrammar(
      params.id,
      body.phrase,
      body.contextSentence ?? DEFAULT_CONTEXT_SENTENCE,
      article.difficulty ?? DEFAULT_ARTICLE_DIFFICULTY,
    );

    await recordGrammarPractice(session.user.id);

    return NextResponse.json(result);
  },
);
