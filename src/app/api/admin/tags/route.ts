import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";

/** Returns tags as a lightweight list for the merge target dropdown (capped at 500). */
export const GET = createAdminHandler({}, async () => {
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return NextResponse.json(tags);
});
