/**
 * Classroom join codes (#1309): teacher-managed, rotatable, expirable short
 * codes that let signed-in learners enroll themselves in a classroom.
 *
 * Each classroom has at most one code row. Rotating issues a fresh code and
 * resets usage; disabling stops redemption without deleting history. Codes are
 * stored normalized (see `./join-code-format`) so teachers can re-display them;
 * brute force is bounded by rate limiting, rotation, expiry, and `maxUses`.
 *
 * Redemption is atomic: a conditional increment (`useCount < maxUses`, re-checked
 * under the row lock) enforces `maxUses` under concurrency, the learner's tenant
 * `Membership` is created as `Student` only when missing (never downgraded), and
 * duplicate joins are idempotent. Mutations write their audit row in the same
 * transaction (ADR-0003). Callers must never log or audit the code itself.
 */
import { randomInt } from "node:crypto";
import { Prisma, type ClassroomJoinCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  normalizeJoinCode,
  type JoinCodeStatus,
  type JoinCodeView,
} from "./join-code-format";

const MAX_GENERATION_ATTEMPTS = 5;
const MAX_REDEEM_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type RandomInt = (max: number) => number;

export type RotatedJoinCode = { joinCode: ClassroomJoinCode; replaced: boolean };

export type RotateJoinCodeInput = {
  classroomId: string;
  actorId: string;
  expiresInDays?: number | null;
  maxUses?: number | null;
  now?: Date;
  random?: RandomInt;
  /** Builds the audit row written in the rotation's transaction. */
  audit?: (rotated: RotatedJoinCode) => AuditRequestInput;
};

export type DisableJoinCodeResult = "disabled" | "already_disabled" | "not_found";

export type JoinCodeFailureReason =
  | "invalid_format"
  | "not_found"
  | "disabled"
  | "expired"
  | "exhausted"
  | "archived"
  /** Concurrent redemptions kept winning the claim; safe to retry. */
  | "contention";

export type JoinedClassroom = {
  ok: true;
  classroomId: string;
  classroomName: string;
  orgId: string;
  alreadyMember: boolean;
  orgMembershipCreated: boolean;
};

export type RedeemJoinCodeResult =
  | JoinedClassroom
  | { ok: false; reason: JoinCodeFailureReason; classroomId?: string; orgId?: string };

/** Draws a fresh code from the unambiguous alphabet. */
export function generateJoinCode(random: RandomInt = randomInt): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[random(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function joinCodeStatus(
  row: Pick<ClassroomJoinCode, "disabledAt" | "expiresAt" | "maxUses" | "useCount">,
  now: Date = new Date(),
): JoinCodeStatus {
  if (row.disabledAt) return "disabled";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.maxUses !== null && row.useCount >= row.maxUses) return "exhausted";
  return "active";
}

export function toJoinCodeView(row: ClassroomJoinCode, now: Date = new Date()): JoinCodeView {
  return {
    displayCode: formatJoinCode(row.code),
    status: joinCodeStatus(row, now),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    useCount: row.useCount,
  };
}

/** The classroom's code as a teacher-facing view, or null when none exists. */
export async function getClassroomJoinCodeView(
  classroomId: string,
  now: Date = new Date(),
): Promise<JoinCodeView | null> {
  const row = await prisma.classroomJoinCode.findUnique({ where: { classroomId } });
  return row ? toJoinCodeView(row, now) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Generates or rotates the classroom's join code, re-enabling it and resetting
 * usage. Retries on the (astronomically unlikely) code collision. Returns the
 * new row and whether an earlier code was replaced.
 */
export async function rotateClassroomJoinCode(input: RotateJoinCodeInput): Promise<RotatedJoinCode> {
  const now = input.now ?? new Date();
  const expiresAt =
    input.expiresInDays == null ? null : new Date(now.getTime() + input.expiresInDays * DAY_MS);
  const settings = {
    createdById: input.actorId,
    expiresAt,
    maxUses: input.maxUses ?? null,
    useCount: 0,
    disabledAt: null,
  };

  for (let attempt = 1; ; attempt++) {
    const code = generateJoinCode(input.random);
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.classroomJoinCode.findUnique({
          where: { classroomId: input.classroomId },
          select: { id: true },
        });
        const joinCode = await tx.classroomJoinCode.upsert({
          where: { classroomId: input.classroomId },
          create: { classroomId: input.classroomId, code, ...settings },
          update: { code, ...settings },
        });
        const rotated = { joinCode, replaced: existing !== null };
        if (input.audit) await recordAuditFromRequest(input.audit(rotated), tx);
        return rotated;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= MAX_GENERATION_ATTEMPTS) throw error;
    }
  }
}

/**
 * Disables the classroom's code. Only an actual state change is audited, so a
 * repeated disable reports `already_disabled` without a second audit row.
 */
export async function disableClassroomJoinCode(
  classroomId: string,
  options: { now?: Date; audit?: () => AuditRequestInput } = {},
): Promise<DisableJoinCodeResult> {
  const now = options.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const result = await tx.classroomJoinCode.updateMany({
      where: { classroomId, disabledAt: null },
      data: { disabledAt: now },
    });
    if (result.count > 0) {
      if (options.audit) await recordAuditFromRequest(options.audit(), tx);
      return "disabled";
    }
    return (await tx.classroomJoinCode.count({ where: { classroomId } })) > 0
      ? "already_disabled"
      : "not_found";
  });
}

type Tx = Prisma.TransactionClient;

async function enroll(
  tx: Tx,
  userId: string,
  classroom: { id: string; orgId: string },
): Promise<{ orgMembershipCreated: boolean }> {
  const membership = await tx.membership.findUnique({
    where: { userId_orgId: { userId, orgId: classroom.orgId } },
    select: { id: true },
  });
  if (!membership) {
    await tx.membership.create({ data: { userId, orgId: classroom.orgId, role: "Student" } });
  }
  await tx.classroomMembership.create({
    data: { classroomId: classroom.id, userId, role: "Student" },
  });
  return { orgMembershipCreated: !membership };
}

type RedeemInput = {
  code: string;
  userId: string;
  now: Date;
  audit?: (joined: JoinedClassroom) => AuditRequestInput;
};

async function redeemOnce(input: RedeemInput): Promise<RedeemJoinCodeResult | null> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.classroomJoinCode.findUnique({
      where: { code: input.code },
      include: { classroom: { select: { id: true, name: true, orgId: true, archivedAt: true } } },
    });
    if (!row) return { ok: false, reason: "not_found" };
    const { classroom } = row;
    const scope = { classroomId: classroom.id, orgId: classroom.orgId };
    if (classroom.archivedAt) return { ok: false, reason: "archived", ...scope };

    const success = {
      ok: true as const,
      classroomId: classroom.id,
      classroomName: classroom.name,
      orgId: classroom.orgId,
    };
    // Existing members succeed even on a since-disabled code, without using it.
    const alreadyMember = await tx.classroomMembership.findUnique({
      where: { classroomId_userId: { classroomId: classroom.id, userId: input.userId } },
      select: { id: true },
    });
    if (alreadyMember) return { ...success, alreadyMember: true, orgMembershipCreated: false };

    const status = joinCodeStatus(row, input.now);
    if (status !== "active") return { ok: false, reason: status, ...scope };

    // Conditional claim: the predicate is re-checked under the row lock, so
    // maxUses holds exactly. A no-op means the code filled up, was disabled, or
    // was rotated concurrently; the caller retries against fresh state.
    const claimed = await tx.classroomJoinCode.updateMany({
      where: {
        id: row.id,
        code: row.code,
        disabledAt: null,
        ...(row.maxUses === null ? {} : { useCount: { lt: row.maxUses } }),
      },
      data: { useCount: { increment: 1 } },
    });
    if (claimed.count === 0) return null;

    const { orgMembershipCreated } = await enroll(tx, input.userId, classroom);
    const joined = { ...success, alreadyMember: false, orgMembershipCreated };
    if (input.audit) await recordAuditFromRequest(input.audit(joined), tx);
    return joined;
  });
}

/**
 * Enrolls `userId` in the code's classroom. Invalid, unknown, disabled,
 * expired, exhausted, and archived-classroom codes fail closed. Joining a
 * classroom you already belong to succeeds without consuming a use (and
 * without an audit row); a new enrollment is audited in its transaction.
 */
export async function redeemClassroomJoinCode(input: {
  code: string;
  userId: string;
  now?: Date;
  audit?: (joined: JoinedClassroom) => AuditRequestInput;
}): Promise<RedeemJoinCodeResult> {
  const code = normalizeJoinCode(input.code);
  if (!code) return { ok: false, reason: "invalid_format" };
  const attemptInput = { ...input, code, now: input.now ?? new Date() };

  for (let attempt = 1; attempt <= MAX_REDEEM_ATTEMPTS; attempt++) {
    try {
      const result = await redeemOnce(attemptInput);
      if (result) return result;
    } catch (error) {
      // A concurrent duplicate join won the membership insert; retrying sees
      // the membership and reports alreadyMember without consuming a use.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { ok: false, reason: "contention" };
}
