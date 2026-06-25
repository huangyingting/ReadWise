import type { BrowserContext } from "@playwright/test";

import { prisma } from "@/lib/prisma";
import {
  createUserWithSession,
  resetE2eDatabase,
  seedE2eArticles,
  TEST_ARTICLE_ID,
} from "@/lib/testing/e2e-fixtures";

export { TEST_ARTICLE_ID, createUserWithSession } from "@/lib/testing/e2e-fixtures";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export async function seedSmokeData(): Promise<void> {
  await resetE2eDatabase();
  await seedE2eArticles();
}

export async function addSessionCookie(
  context: BrowserContext,
  sessionToken: string,
  expires: Date,
): Promise<void> {
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(expires.getTime() / 1000),
    },
  ]);
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
