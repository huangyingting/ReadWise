import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, queryString } from "@/lib/validation";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { searchClassroomStudentCandidates } from "@/lib/classroom";

const pickerQuery = (params: URLSearchParams) => ({
  ok: true as const,
  value: { q: queryString(params, "q").slice(0, 100) },
});

export const GET = createHandler(
  { params: idParams, query: pickerQuery },
  async ({ params, query, session }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    const candidates = await searchClassroomStudentCandidates(params.id, classroom.orgId, query.q);
    return NextResponse.json({ candidates });
  },
);
