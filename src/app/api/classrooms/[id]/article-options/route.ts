import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, queryString } from "@/lib/validation";
import { articleAccessContext } from "@/lib/article-library";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { searchAssignableArticleOptions } from "@/lib/classroom";

const pickerQuery = (params: URLSearchParams) => ({
  ok: true as const,
  value: { q: queryString(params, "q").slice(0, 100) },
});

export const GET = createHandler(
  { params: idParams, query: pickerQuery },
  async ({ params, query, session }) => {
    await requireClassroomManageApi(session, params.id);
    const articles = await searchAssignableArticleOptions(
      articleAccessContext(session.user),
      query.q,
    );
    return NextResponse.json({ articles });
  },
);
