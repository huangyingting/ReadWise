import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { submitWriteResponse } from "@/lib/classroom/writing";
import { writeBody, writeError } from "@/lib/classroom/writing-http";

/** Submits the learner's response (#1305); a returned response counts as a revision. */
export const POST = createHandler({ params: idParams, body: writeBody }, async ({ params, body, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const result = await submitWriteResponse(session.user.id, article, body);
  if (!result.ok) throw writeError(result);
  return NextResponse.json({ submission: result.submission });
});
