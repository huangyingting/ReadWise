import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { nonEmptyString, object } from "@/lib/validation";
import { redeemClassroomJoinCode } from "@/lib/classroom";
import type { JoinCodeFailureReason } from "@/lib/classroom/join-codes";
import { JOIN_CODE_INPUT_MAX_LENGTH } from "@/lib/classroom/join-code-format";
import {
  assertRateLimitAvailableByKey,
  checkRateLimitByKey,
  clientIpKey,
} from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security/events";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const joinClassroomBody = object({ code: nonEmptyString(JOIN_CODE_INPUT_MAX_LENGTH) });

const INVALID_CODE = { status: 404, message: "That class code isn't valid. Check it with your teacher." };

/**
 * Learner-facing outcome per failure. Unknown and teacher-disabled codes share
 * one message; the rest only reach a caller who already holds a real code, so
 * naming the reason leaks nothing guessable.
 */
const JOIN_FAILURES: Record<JoinCodeFailureReason, { status: number; message: string }> = {
  invalid_format: { status: 400, message: "Class codes are 8 letters and numbers, like ABCD-2345." },
  not_found: INVALID_CODE,
  disabled: INVALID_CODE,
  expired: { status: 410, message: "That class code has expired. Ask your teacher for a new one." },
  exhausted: { status: 409, message: "That class is full. Ask your teacher for a new code." },
  archived: { status: 409, message: "That class is no longer active." },
  contention: { status: 409, message: "Lots of students are joining right now. Try again in a moment." },
};

/**
 * Charges one failed attempt to the per-IP failure budget. Going over budget
 * here still returns this attempt's own failure; the next attempt from the IP
 * is refused up front.
 */
async function chargeFailedAttempt(key: string): Promise<void> {
  try {
    await checkRateLimitByKey(key, "auth");
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 429)) throw error;
  }
}

/**
 * Redeems a classroom join code for the signed-in learner (#1309), enrolling
 * them as a Student (creating their tenant Student membership if needed).
 *
 * Every attempt counts against the per-user "auth" limit; per IP only FAILED
 * attempts count, so a whole class behind one school NAT can join at once
 * while guessing from that IP stays bounded. Over-limit requests get a 429
 * (recorded as a security event by the api-handler). Failures emit a security
 * event plus an audit row; a new enrollment is audited in its transaction.
 * The code itself is never logged or audited.
 */
export const POST = createHandler(
  { body: joinClassroomBody },
  async ({ req, body, session, requestId }) => {
    await checkRateLimitByKey(`classroom-join:user:${session.user.id}`, "auth");
    const ipFailureKey = `classroom-join:failed:${clientIpKey(req)}`;
    await assertRateLimitAvailableByKey(ipFailureKey, "auth");

    const result = await redeemClassroomJoinCode({
      code: body.code,
      userId: session.user.id,
      audit: (joined) => ({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.classroomJoinedViaCode,
        targetType: "classroom",
        targetId: joined.classroomId,
        metadata: { orgId: joined.orgId, orgMembershipCreated: joined.orgMembershipCreated },
      }),
    });

    if (!result.ok) {
      const failure = JOIN_FAILURES[result.reason];
      if (result.reason !== "contention") await chargeFailedAttempt(ipFailureKey);
      recordSecurityEvent({
        type: SECURITY_EVENT_TYPES.classroomJoinFailed,
        severity: "low",
        route: "/api/classrooms/join",
        status: failure.status,
        actorId: session.user.id,
        ip: clientIp(req),
        meta: { reason: result.reason },
      });
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.classroomJoinCodeFailed,
        targetType: "classroom",
        targetId: result.classroomId ?? null,
        metadata: { reason: result.reason, ...(result.orgId ? { orgId: result.orgId } : {}) },
      });
      throw new ApiError(failure.status, failure.message);
    }

    return NextResponse.json({
      ok: true,
      alreadyMember: result.alreadyMember,
      classroom: { id: result.classroomId, name: result.classroomName },
    });
  },
);
