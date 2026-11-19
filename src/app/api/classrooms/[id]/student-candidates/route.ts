import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, searchTermQuery } from "@/lib/validation";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { searchClassroomStudentCandidates } from "@/lib/classroom";

export const GET = createHandler(
  { params: idParams, query: searchTermQuery() },
  async ({ params, query, session }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    const candidates = await searchClassroomStudentCandidates(params.id, classroom.orgId, query.q);
    return NextResponse.json({ candidates });
  },
);
