/**
 * Request schemas and error mapping for the classroom annotations API (#1307).
 */
import { nonEmptyString, nullable, number, object, optional, string } from "@/lib/validation";
import { ApiError } from "@/lib/errors/api-error";
import {
  ANNOTATION_PROMPT_MAX_LENGTH,
  ANNOTATION_QUOTE_MAX_LENGTH,
  ANNOTATION_RESPONSE_MAX_LENGTH,
} from "./annotation-limits";
import type { AnnotationFailure } from "./annotations";

const MAX_ANCHOR_OFFSET = 10_000_000;
const MAX_ANCHOR_CONTEXT_CHARS = 256;

const anchorFields = {
  quote: string({ min: 1, max: ANNOTATION_QUOTE_MAX_LENGTH, trim: false }),
  startOffset: number({ int: true, min: 0, max: MAX_ANCHOR_OFFSET }),
  endOffset: number({ int: true, min: 1, max: MAX_ANCHOR_OFFSET }),
  prefix: optional(string({ max: MAX_ANCHOR_CONTEXT_CHARS, trim: false })),
  suffix: optional(string({ max: MAX_ANCHOR_CONTEXT_CHARS, trim: false })),
};

export const createGuideBody = object({
  ...anchorFields,
  prompt: nonEmptyString(ANNOTATION_PROMPT_MAX_LENGTH),
});

export const updateGuideBody = object({
  prompt: nonEmptyString(ANNOTATION_PROMPT_MAX_LENGTH),
});

export const responseBody = object({
  annotationId: nullable(nonEmptyString(64)),
  anchor: nullable(object(anchorFields)),
  body: string({ max: ANNOTATION_RESPONSE_MAX_LENGTH }),
});

const MESSAGES: Record<AnnotationFailure["reason"], string> = {
  invalid_anchor: "Choose a passage from the article",
  empty_response: "Write a reply or choose a passage",
  forbidden: "Forbidden",
  not_found: "Not found",
  archived: "Classroom is archived",
};

export function annotationError(failure: AnnotationFailure): ApiError {
  return new ApiError(failure.status, MESSAGES[failure.reason]);
}
