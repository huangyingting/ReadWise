import { NextResponse } from "next/server";
import type { ClassroomRole } from "@prisma/client";
import { createHandler } from "@/lib/api-handler";
import { idParams, object, oneOf, optional, nonEmptyString } from "@/lib/validation";
import { CLASSROOM_ROLES } from "@/lib/rbac";
import { addClassroomMember } from "@/lib/classroom";
import { requireClassroomManageApi } from "@/lib/tenant-api";

const addClassroomMemberBody = object({
  userId: nonEmptyString(200),
  role: optional(oneOf<ClassroomRole>(CLASSROOM_ROLES)),
});

/**
 * Adds (or re-roles) a member of a classroom (RW-061). Requires the caller to
 * manage the classroom (its teacher, the org admin, or a system admin). Defaults
 * the role to Student.
 */
export const POST = createHandler(
  { params: idParams, body: addClassroomMemberBody },
  async ({ params, body, session }) => {
    await requireClassroomManageApi(session, params.id);
    const member = await addClassroomMember(params.id, body.userId, body.role ?? "Student");
    return NextResponse.json({ ok: true, member }, { status: 201 });
  },
);
