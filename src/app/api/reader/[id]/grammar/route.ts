import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { explainGrammar } from "@/lib/grammar";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { recordSkillEvidence } from "@/lib/skill-mastery";
import { bestEffortMastery } from "@/lib/mastery";
import { grammarBody } from "@/lib/reader/schemas";

export const POST = createHandler(
  { params: idParams, body: grammarBody },
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
