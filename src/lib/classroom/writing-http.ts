/**
 * Request schemas and error mapping for the Write Prompt API (#1305).
 */
import { nonEmptyString, nullable, object, oneOf, optional, string, type Schema } from "@/lib/validation";
import { ApiError } from "@/lib/errors/api-error";
import { WRITE_BODY_MAX_LENGTH } from "./writing-rubric";
import type { WriteFailure } from "./writing";

export const writeBody = object({
  assignmentId: nullable(nonEmptyString(64)),
  body: string({ max: WRITE_BODY_MAX_LENGTH, trim: false }),
});

/** Rubric scores are sanitized by the domain; only the shape is checked here. */
const rubricShape: Schema<Record<string, unknown>> = (value, field) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : { ok: false, error: `${field ?? "rubricScores"} must be an object` };

export const reviewBody = object({
  action: oneOf(["grade", "return"] as const),
  rubricScores: rubricShape,
  feedback: optional(string({ max: 4000 })),
});

const MESSAGES: Record<WriteFailure["reason"], string> = {
  empty_response: "Write something before submitting",
  forbidden: "Forbidden",
  not_found: "Not found",
  locked: "This response was submitted and is waiting for your teacher",
  not_reviewable: "Only submitted responses can be reviewed",
};

export function writeError(failure: WriteFailure): ApiError {
  return new ApiError(failure.status, MESSAGES[failure.reason]);
}
