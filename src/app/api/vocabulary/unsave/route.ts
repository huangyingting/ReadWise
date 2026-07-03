import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { unsaveWord } from "@/lib/lexical/saved-words";
import { unsaveWordBody } from "@/lib/vocabulary/schemas";

export const POST = createHandler({ body: unsaveWordBody }, async ({ body, session }) => {
  await unsaveWord(session.user.id, body.word);
  return unsavedWordResponse(body.word);
});

function unsavedWordResponse(word: string): NextResponse {
  return NextResponse.json({ word, saved: false });
}
