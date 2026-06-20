import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { exportUserData } from "@/lib/account";

export const GET = createHandler({}, async ({ session }) => {
  const data = await exportUserData(session.user.id);
  const date = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="readwise-data-export-${date}.json"`,
    },
  });
});
