/**
 * Client-safe limits for classroom annotations (#1307).
 */

/** Teacher guided prompt length. */
export const ANNOTATION_PROMPT_MAX_LENGTH = 1000;
/** Student reply / evidence explanation length. */
export const ANNOTATION_RESPONSE_MAX_LENGTH = 2000;
/** Longest passage a prompt or evidence highlight may anchor to. */
export const ANNOTATION_QUOTE_MAX_LENGTH = 2000;
