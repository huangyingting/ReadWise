import { randomBytes } from "node:crypto";
import type { Prisma, Session } from "@prisma/client";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

type SessionClient = Pick<Prisma.TransactionClient, "session">;

export async function createDatabaseSession(
  client: SessionClient,
  userId: string,
  now = new Date(),
): Promise<Session> {
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  return client.session.create({
    data: {
      sessionToken: randomBytes(32).toString("base64url"),
      userId,
      expires,
    },
  });
}
