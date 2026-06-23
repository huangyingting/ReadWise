import { NextResponse } from "next/server";
import { TagScope } from "@prisma/client";
import { createAdminHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";

/** Returns tags as a lightweight list for the merge target dropdown (capped at 500). */
export const GET = createAdminHandler({}, async () => {
  const tags = await prisma.tag.findMany({
    where: { scope: TagScope.PUBLIC },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return NextResponse.json(tags);
});
