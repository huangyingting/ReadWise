import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";

/** Returns all tags as a lightweight list for the merge target dropdown. */
export const GET = createAdminHandler({}, async () => {
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(tags);
});
