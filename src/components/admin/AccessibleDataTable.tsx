/**
 * Visually-hidden accessible data table (sr-only fallback) used by SSR chart
 * components to provide a screen-reader-friendly data alternative alongside
 * the visual chart. Consumed by BarChart and WeeklyBars.
 */
export interface AccessibleDataTableColumn {
  key: string;
  label: string;
}

export interface AccessibleDataTableRow {
  [key: string]: React.ReactNode;
}

export function AccessibleDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: AccessibleDataTableColumn[];
  rows: AccessibleDataTableRow[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} scope="col">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={col.key}>{row[col.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
