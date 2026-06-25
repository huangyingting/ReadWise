/**
 * Pure validation utility for reading-list names.
 * Shared by all list create/rename UI so validation messages stay consistent.
 */

export const LIST_NAME_MAX_LENGTH = 60;

/**
 * Returns an error string if the name is invalid, or null if valid.
 * Trims the name before checking.
 */
export function validateListName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed.length > LIST_NAME_MAX_LENGTH)
    return `Must be ${LIST_NAME_MAX_LENGTH} characters or less`;
  return null;
}
