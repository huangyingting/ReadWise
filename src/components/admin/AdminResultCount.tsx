function formatResultCount({
  noun,
  page,
  pageSize,
  total,
}: {
  noun: string;
  page: number;
  pageSize: number;
  total: number;
}) {
  if (total === 0) {
    return `No ${noun} match.`;
  }

  const showingFrom = (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);
  return `Showing ${showingFrom}–${showingTo} of ${total}`;
}

/**
 * Displays "No {noun} match." or "Showing X–Y of total" above a paginated
 * admin list. Pass the same `page` / `pageSize` / `total` values used to
 * drive the list.
 */
export function AdminResultCount({
  total,
  page,
  pageSize,
  noun = "results",
}: {
  total: number;
  page: number;
  pageSize: number;
  noun?: string;
}) {
  const resultText = formatResultCount({ noun, page, pageSize, total });

  return (
    <p className="m-0 text-[length:var(--type-ui)] text-text-subtle">
      {resultText}
    </p>
  );
}
