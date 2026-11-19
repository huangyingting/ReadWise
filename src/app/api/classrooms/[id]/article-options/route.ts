import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, searchTermQuery } from "@/lib/validation";
import { articleAccessContext } from "@/lib/article-library";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { searchAssignableArticleOptions } from "@/lib/classroom";

export const GET = createHandler(
  { params: idParams, query: searchTermQuery() },
  async ({ params, query, session }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    const articles = await searchAssignableArticleOptions(
      articleAccessContext(session.user, classroom.orgId),
      query.q,
    );
    return NextResponse.json({ articles });
  },
);
