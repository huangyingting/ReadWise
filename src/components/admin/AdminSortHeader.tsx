import Link from "next/link";

type SortOrder = "asc" | "desc";

interface AdminSortHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string;
  currentOrder: SortOrder;
  buildHref: (sort: string, order: SortOrder) => string;
}

function sortDescription(
  label: string,
  isActive: boolean,
  currentOrder: SortOrder,
  nextOrder: SortOrder,
): string {
  if (!isActive) return `${label}: activate to sort ascending`;
  return `${label}: sorted ${currentOrder === "asc" ? "ascending" : "descending"}. Activate to sort ${nextOrder === "asc" ? "ascending" : "descending"}`;
}

export function AdminSortHeader({
  label,
  sortKey,
  currentSort,
  currentOrder,
  buildHref,
}: AdminSortHeaderProps) {
  const isActive = currentSort === sortKey;
  const nextOrder: SortOrder = isActive && currentOrder === "asc" ? "desc" : "asc";
  const ariaSort = isActive
    ? currentOrder === "asc"
      ? "ascending"
      : "descending"
    : undefined;

  return (
    <th scope="col" aria-sort={ariaSort}>
      <Link
        href={buildHref(sortKey, nextOrder)}
        className="admin-sort-link"
        aria-label={sortDescription(label, isActive, currentOrder, nextOrder)}
      >
        <span>{label}</span>
        <span aria-hidden>{isActive ? (currentOrder === "asc" ? "↑" : "↓") : "↕"}</span>
      </Link>
    </th>
  );
}

export interface AdminTableColumn {
  label: string;
  /** Omit for a column that can't be sorted. */
  sortKey?: string;
}

/** A table header row: sortable columns link to their sort, the rest are plain headers. */
export function AdminSortHeaderRow({
  columns,
  currentSort,
  currentOrder,
  buildHref,
}: {
  columns: readonly AdminTableColumn[];
  currentSort: string;
  currentOrder: SortOrder;
  buildHref: (sort: string, order: SortOrder) => string;
}) {
  return (
    <tr>
      {columns.map(({ label, sortKey }) =>
        sortKey ? (
          <AdminSortHeader
            key={label}
            label={label}
            sortKey={sortKey}
            currentSort={currentSort}
            currentOrder={currentOrder}
            buildHref={buildHref}
          />
        ) : (
          <th key={label} scope="col">
            {label}
          </th>
        ),
      )}
    </tr>
  );
}
