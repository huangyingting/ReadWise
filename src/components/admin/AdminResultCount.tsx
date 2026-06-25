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
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  return (
    <p className="muted" style={{ margin: 0 }}>
      {total === 0
        ? `No ${noun} match.`
        : `Showing ${showingFrom}–${showingTo} of ${total}`}
    </p>
  );
}
