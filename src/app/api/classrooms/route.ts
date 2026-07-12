import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, string, nonEmptyString } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { createClassroom, listClassroomsForTeacher } from "@/lib/classroom";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

const createClassroomBody = object({
  orgId: nonEmptyString(200),
  name: string({ min: 1, max: 120 }),
});

const CREATED_STATUS = 201;

function classroomCreateInput(body: { orgId: string; name: string }, teacherId: string) {
  return {
    orgId: body.orgId,
    name: body.name,
    teacherId,
  };
}

/**
 * Lists classrooms the caller teaches/manages (RW-061).
 */
export const GET = createHandler(
  {},
  async ({ session }) => {
    const classrooms = await listClassroomsForTeacher(session.user.id);
    return NextResponse.json({ classrooms });
  },
);

/**
 * Creates a classroom in an organization (RW-061). Requires the caller to hold
 * `classroom.manage` within the org (Teacher or OrgAdmin) or be a system admin.
 * The creator becomes the classroom's teacher.
 */
export const POST = createHandler(
  { body: createClassroomBody },
  async ({ body, session }) => {
    await requireOrgCapabilityApi(session, body.orgId, CAPABILITIES.classroomManage);
    const classroom = await createClassroom(classroomCreateInput(body, session.user.id));
    return NextResponse.json({ classroom }, { status: CREATED_STATUS });
  },
);
