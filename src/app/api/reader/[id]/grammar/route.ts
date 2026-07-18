import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { explainGrammar } from "@/lib/grammar";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { recordLearnerEvidence } from "@/lib/learning/learner-evidence";
import { grammarBody } from "@/lib/reader/schemas";

const DEFAULT_CONTEXT_SENTENCE = "";
const DEFAULT_ARTICLE_DIFFICULTY = "B1";

async function recordGrammarPractice(userId: string) {
  // Best-effort: engaging with grammar help is mild grammar-skill evidence.
  await recordLearnerEvidence(userId, { activity: "grammar-help-used" });
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
