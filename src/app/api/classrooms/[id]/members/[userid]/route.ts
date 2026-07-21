import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { removeClassroomMember } from "@/lib/classroom";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";

const classroomMemberParams = object({
  id: nonEmptyString(200),
  userid: nonEmptyString(200),
});

export const DELETE = createHandler(
  { params: classroomMemberParams },
  async ({ params, session }) => {
    await requireActiveClassroomManageApi(session, params.id);
    await removeClassroomMember(params.id, params.userid);
    return NextResponse.json({ ok: true });
  },
);
