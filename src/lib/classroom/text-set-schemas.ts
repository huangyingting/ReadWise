/**
 * Request schemas and error mapping for the Text Set API (#1308).
 */
import { array, nonEmptyString, nullable, object, oneOf, optional, string } from "@/lib/validation";
import { ApiError } from "@/lib/errors/api-error";
import { TEXT_SET_MAX_ITEMS, TEXT_SET_VISIBILITIES, type TextSetFailure } from "./text-sets";

const textSetFields = {
  title: nonEmptyString(200),
  essentialQuestion: nullable(string({ max: 500 })),
  description: nullable(string({ max: 2000 })),
  educatorNotes: nullable(string({ max: 4000 })),
  visibility: oneOf(TEXT_SET_VISIBILITIES),
  items: array(
    object({ articleId: nonEmptyString(64), guidingNote: nullable(string({ max: 1000 })) }),
    { max: TEXT_SET_MAX_ITEMS },
  ),
};

export const createTextSetBody = object({ organizationId: nonEmptyString(64), ...textSetFields });
export const updateTextSetBody = object(textSetFields);
export const assignTextSetBody = object({
  classroomIds: array(nonEmptyString(64), { max: 20 }),
  dueDate: optional(string({ max: 40 })),
});

const FAILURE_MESSAGES: Record<TextSetFailure["reason"], string> = {
  empty_items: "Add at least one article to the text set",
  invalid_articles: "One or more articles aren't available to this organization",
  invalid_classrooms: "Choose active classrooms you manage in this organization",
  forbidden: "Forbidden",
  not_found: "Text set not found",
};

export function textSetError(failure: TextSetFailure): ApiError {
  return new ApiError(failure.status, FAILURE_MESSAGES[failure.reason]);
}
