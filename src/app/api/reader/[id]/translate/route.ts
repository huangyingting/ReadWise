import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import {
  getOrCreateTranslation,
  isSupportedLanguage,
} from "@/lib/translation";

type TranslatePayload = {
  lang?: unknown;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireSessionApi();
  if (error) {
    return error;
  }

  const { id } = await params;

  let body: TranslatePayload;
  try {
    body = (await req.json()) as TranslatePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lang = typeof body.lang === "string" ? body.lang : "";
  if (!isSupportedLanguage(lang)) {
    return NextResponse.json(
      { error: "Unsupported target language" },
      { status: 400 },
    );
  }

  const result = await getOrCreateTranslation(id, lang);
  if (!result) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
