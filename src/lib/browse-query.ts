export const BROWSE_QUERY_MAX_LENGTH = 120;

export function normalizeBrowseQuery(value?: string | null): string | null {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.slice(0, BROWSE_QUERY_MAX_LENGTH);
}
