import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, queryString } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getWriteContext, saveWriteDraft } from "@/lib/classroom/writing";
import { writeBody, writeError } from "@/lib/classroom/writing-http";

function parseQuery(params: URLSearchParams) {
  return { ok: true as const, value: { assignmentId: queryString(params, "assignmentId") || null } };
}

/**
 * The learner's Write Prompt context for an article (#1305): their
 * assignments of it, the resolved prompt, and their response for the scope
 * (`?assignmentId=` for classroom work, omitted for independent writing).
 */
export const GET = createHandler({ params: idParams, query: parseQuery }, async ({ params, query, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const result = await getWriteContext(session.user.id, article, query.assignmentId);
  if (!result.ok) throw writeError(result);
  return NextResponse.json(result.context);
});

/** Autosaves the learner's draft. Submitted assignment work is locked (409). */
export const PUT = createHandler({ params: idParams, body: writeBody }, async ({ params, body, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const result = await saveWriteDraft(session.user.id, article, body);
  if (!result.ok) throw writeError(result);
  return NextResponse.json({ submission: result.submission });
});
