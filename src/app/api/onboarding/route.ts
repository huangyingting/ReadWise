import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionApi } from "@/lib/api-auth";
import { isValidCategorySlug } from "@/lib/categories";
import {
  AGE_RANGES,
  ENGLISH_LEVELS,
  GENDERS,
  type AgeRange,
  type EnglishLevel,
  type Gender,
} from "@/lib/profile";

type OnboardingPayload = {
  ageRange?: unknown;
  gender?: unknown;
  englishLevel?: unknown;
  topics?: unknown;
};

export async function POST(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  let body: OnboardingPayload;
  try {
    body = (await req.json()) as OnboardingPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const englishLevel = body.englishLevel;
  if (
    typeof englishLevel !== "string" ||
    !ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
  ) {
    return NextResponse.json(
      { error: "A valid English level (A1-C2) is required" },
      { status: 400 },
    );
  }

  let ageRange: AgeRange | null = null;
  if (body.ageRange != null && body.ageRange !== "") {
    if (
      typeof body.ageRange !== "string" ||
      !AGE_RANGES.includes(body.ageRange as AgeRange)
    ) {
      return NextResponse.json({ error: "Invalid age range" }, { status: 400 });
    }
    ageRange = body.ageRange as AgeRange;
  }

  let gender: Gender | null = null;
  if (body.gender != null && body.gender !== "") {
    if (
      typeof body.gender !== "string" ||
      !GENDERS.includes(body.gender as Gender)
    ) {
      return NextResponse.json({ error: "Invalid gender" }, { status: 400 });
    }
    gender = body.gender as Gender;
  }

  const rawTopics = Array.isArray(body.topics) ? body.topics : [];
  const topics = Array.from(
    new Set(
      rawTopics.filter(
        (t): t is string => typeof t === "string" && isValidCategorySlug(t),
      ),
    ),
  );

  const data = {
    ageRange,
    gender,
    englishLevel,
    topics: JSON.stringify(topics),
    completedAt: new Date(),
  };

  await prisma.profile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}
