import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { unsaveWord } from "@/lib/vocabulary";

const bodySchema = object({ word: nonEmptyString(200) });

export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  await unsaveWord(session.user.id, body.word);
  return NextResponse.json({ word: body.word, saved: false });
});
