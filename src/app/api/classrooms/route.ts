import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, queryString, string, nonEmptyString } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import {
  createClassroom,
  listArchivedClassroomsForTeacher,
  listClassroomsForTeacher,
} from "@/lib/classroom";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

const createClassroomBody = object({
  orgId: nonEmptyString(200),
  name: string({ min: 1, max: 120 }),
});

const CREATED_STATUS = 201;

const listQuery = (params: URLSearchParams) => ({
  ok: true as const,
  value: { archived: queryString(params, "archived") === "true" },
});

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
  { query: listQuery },
  async ({ query, session }) => {
    const classrooms = query.archived
      ? await listArchivedClassroomsForTeacher(session.user.id)
      : await listClassroomsForTeacher(session.user.id);
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
