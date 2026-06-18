import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf } from "@/lib/validation";
import { updateMemberRole, deleteMember } from "@/lib/admin-members";
import type { Role } from "@prisma/client";

const roleBody = object({ role: oneOf<Role>(["Admin", "Reader"]) });

export const PATCH = createAdminHandler(
  { params: idParams, body: roleBody },
  async ({ params, body, session }) => {
    if (params.id === session.user.id && body.role !== "Admin") {
      throw new ApiError(409, "You cannot remove your own admin role");
    }
    const result = await updateMemberRole(params.id, body.role);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ ok: true, role: result.role });
  },
);

export const DELETE = createAdminHandler(
  { params: idParams },
  async ({ params, session }) => {
    if (params.id === session.user.id) {
      throw new ApiError(409, "You cannot remove your own account");
    }
    const result = await deleteMember(params.id);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ ok: true });
  },
);
