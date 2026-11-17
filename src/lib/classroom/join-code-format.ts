/**
 * Client-safe classroom join code format and view contract (#1309).
 *
 * Shared by the server commands in `./join-codes` and the teacher/learner UI,
 * so it must stay free of server-only imports. Codes are 8 characters from an
 * unambiguous 31-character alphabet (no 0/O/1/I/L), stored normalized and
 * displayed as "ABCD-2345".
 */

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;
/** Longest raw input accepted before normalization (room for separators/spaces). */
export const JOIN_CODE_INPUT_MAX_LENGTH = 16;
export const JOIN_CODE_MAX_USES_LIMIT = 1000;
export const JOIN_CODE_MAX_EXPIRY_DAYS = 365;

const JOIN_CODE_PATTERN = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

export type JoinCodeStatus = "active" | "disabled" | "expired" | "exhausted";

/** Teacher-facing view of a classroom's code; `displayCode` is formatted. */
export type JoinCodeView = {
  displayCode: string;
  status: JoinCodeStatus;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
};

/**
 * Normalizes user input ("abcd 2345", "ABCD-2345") to the stored form, or null
 * when it cannot be a join code. Lower-case is accepted; ambiguous characters
 * are rejected rather than guessed.
 */
export function normalizeJoinCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[\s-]+/g, "");
  return JOIN_CODE_PATTERN.test(normalized) ? normalized : null;
}

/** Display form of a stored code, e.g. "ABCD-2345". */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
