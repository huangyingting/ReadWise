/**
 * Request schemas and error mapping for assignment reading activities (#1304).
 */
import { array, nullable, number, object, oneOf, optional, string } from "@/lib/validation";
import { READING_LEVEL_KEYS } from "@/lib/article-levels/levels";
import { ApiError } from "@/lib/errors/api-error";
import { CHECK_OPTIONS_MAX, POLL_OPTIONS_MAX, type ActivityFailure } from "./activities";

const QUESTION_MAX = 500;
const OPTION_MAX = 200;
const EXPLANATION_MAX = 600;

export const pollBody = object({
  question: string({ min: 1, max: QUESTION_MAX }),
  options: array(string({ max: OPTION_MAX }), { max: POLL_OPTIONS_MAX }),
});

export const checkBody = object({
  afterBlock: number({ int: true, min: 0, max: 10_000 }),
  question: string({ min: 1, max: QUESTION_MAX }),
  options: array(string({ max: OPTION_MAX }), { max: CHECK_OPTIONS_MAX }),
  correctIndex: number({ int: true, min: 0, max: CHECK_OPTIONS_MAX - 1 }),
  explanation: optional(nullable(string({ max: EXPLANATION_MAX }))),
  levelKey: optional(nullable(oneOf(READING_LEVEL_KEYS))),
});

export const voteBody = object({ optionIndex: number({ int: true, min: 0, max: 20 }) });
export const answerBody = object({ selectedIndex: number({ int: true, min: 0, max: 20 }) });

const MESSAGES: Record<ActivityFailure["reason"], string> = {
  invalid_option: "Choose one of the options",
  invalid_activity: "Add a question and distinct options",
  forbidden: "Forbidden",
  not_found: "Not found",
  already_answered: "You already answered this check",
  archived: "Classroom is archived",
};

export function activityError(failure: ActivityFailure): ApiError {
  return new ApiError(failure.status, MESSAGES[failure.reason]);
}
