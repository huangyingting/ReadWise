const ZERO_MARGIN_STYLE = { margin: 0 };

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
    <p className="muted" style={ZERO_MARGIN_STYLE}>
      {resultText}
    </p>
  );
}
