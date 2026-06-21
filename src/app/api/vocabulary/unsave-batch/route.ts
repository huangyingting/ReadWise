import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, array, nonEmptyString } from "@/lib/validation";
import { prisma } from "@/lib/prisma";

const bodySchema = object({
  words: array(nonEmptyString(200), { max: 200 }),
});

/**
 * POST /api/vocabulary/unsave-batch
 *
 * Removes multiple words from the user's study list in one request.
 * Silently skips words that aren't in the list.
 *
 * Body: { words: string[] }   (1–200 words)
 * Response 200: { removed: number }
 */
export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  const { count } = await prisma.savedWord.deleteMany({
    where: {
      userId: session.user.id,
      word: { in: body.words },
    },
  });
  return NextResponse.json({ removed: count });
});
