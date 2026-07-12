import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireClassroomManageApi } from "@/lib/tenant-api";

/**
 * Returns classroom detail when the caller can manage the classroom.
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    return NextResponse.json({ classroom });
  },
);
