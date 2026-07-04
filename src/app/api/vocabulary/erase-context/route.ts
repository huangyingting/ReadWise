import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { clearSavedWordContextSentence } from "@/lib/lexical/saved-words";
import { eraseSavedWordContextBody } from "@/lib/vocabulary/schemas";

export const POST = createHandler(
  { body: eraseSavedWordContextBody },
  async ({ body, session }) => {
    const count = await clearSavedWordContextSentence(session.user.id, body.word);
    return NextResponse.json({ erased: count > 0 });
  },
);
