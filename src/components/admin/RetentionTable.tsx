import { Card } from "@/components/ui/Card";
import { AdminTableWrap } from "./AdminTableWrap";
import type { RetentionCohort } from "@/lib/analytics/product";

/**
 * Weekly retention cohort grid. Each row is a cohort (users grouped by the week
 * of their first activity); each cell is the share of that cohort still active
 * `n` weeks later, shaded by intensity. SSR-only — no client JS.
 */
export function RetentionTable({ cohorts }: { cohorts: RetentionCohort[] }) {
  const nonEmpty = cohorts.filter((c) => c.size > 0);
  if (nonEmpty.length === 0) {
    return <p className="muted">No retention data for this period yet.</p>;
  }
  const maxWeeks = Math.max(...nonEmpty.map((c) => c.cells.length));

  return (
    <Card>
      <AdminTableWrap ariaLabel="Retention cohorts (scrollable)">
        <caption className="sr-only">
          Weekly retention by cohort. Each cell shows the percentage of the
          cohort active that many weeks after their first week.
        </caption>
        <thead>
            <tr>
              <th scope="col">Cohort week</th>
              <th scope="col">Users</th>
              {Array.from({ length: maxWeeks }, (_, i) => (
                <th key={i} scope="col">
                  W{i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nonEmpty.map((cohort) => (
              <tr key={cohort.cohortWeek}>
                <th scope="row" className="whitespace-nowrap">
                  {cohort.cohortWeek}
                </th>
                <td>{cohort.size}</td>
                {Array.from({ length: maxWeeks }, (_, i) => {
                  const cell = cohort.cells[i];
                  if (!cell) {
                    return <td key={i} aria-hidden="true" />;
                  }
                  const intensity = Math.round((cell.pct / 100) * 70);
                  return (
                    <td
                      key={i}
                      style={{
                        backgroundColor: `color-mix(in srgb, var(--primary) ${intensity}%, transparent)`,
                        textAlign: "center",
                      }}
                      title={`${cell.count} of ${cohort.size} active`}
                    >
                      {cell.pct}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
    </Card>
  );
}
