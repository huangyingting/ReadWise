import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { isEducator } from "@/lib/classroom/educator";
import { getOrCreateLessonScaffold } from "@/lib/lesson/scaffold";

/**
 * "Apply to your lesson" scaffolds for educators (#1304): before-reading hook,
 * discussion questions, and key terms. Teachers, content staff, and platform
 * super-users only; falls back to deterministic scaffolds without AI.
 */
export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  if (!(await isEducator(session.user))) throw new ApiError(403, "Forbidden");
  const { context } = await requireReadableArticleForAI(params.id, session.user);
  const scaffold = await getOrCreateLessonScaffold(params.id, context);
  if (!scaffold) throw new ApiError(404, "Article not found");
  return NextResponse.json(scaffold);
});
