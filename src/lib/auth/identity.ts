import { Role } from "@prisma/client";
import type { Session } from "next-auth";

const DEFAULT_ROLE: Role = Role.Reader;
const ROLE_VALUES = new Set<string>(Object.values(Role));

type SessionCallbackUser = { id: string } & Partial<Record<"role", unknown>>;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_VALUES.has(value);
}

function roleFromSessionUser(user: SessionCallbackUser): Role {
  return isRole(user.role) ? user.role : DEFAULT_ROLE;
}

export function assignSessionIdentity(
  session: Session,
  user: SessionCallbackUser,
): Session {
  if (!session.user) {
    return session;
  }

  session.user.id = user.id;
  session.user.role = roleFromSessionUser(user);
  return session;
}
