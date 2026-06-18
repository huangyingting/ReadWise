import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { lookupWord } from "@/lib/dictionary";

const bodySchema = object({ word: nonEmptyString(200) });

export const POST = createHandler({ body: bodySchema }, async ({ body }) => {
  const result = await lookupWord(body.word);
  return NextResponse.json(result);
});
