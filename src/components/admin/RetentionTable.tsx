import { Card } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui";
import { AdminTableWrap } from "./AdminTableWrap";
import type { RetentionCohort } from "@/lib/analytics/queries";

const MAX_CELL_SHADE_PERCENT = 70;

type RetentionTableProps = {
  cohorts: RetentionCohort[];
};

type RetentionCell = RetentionCohort["cells"][number];

function getNonEmptyCohorts(cohorts: RetentionCohort[]): RetentionCohort[] {
  return cohorts.filter((cohort) => cohort.size > 0);
}

function getMaxWeekCount(cohorts: RetentionCohort[]): number {
  return Math.max(...cohorts.map((cohort) => cohort.cells.length));
}

function getCellIntensity(cell: RetentionCell): number {
  return Math.round((cell.pct / 100) * MAX_CELL_SHADE_PERCENT);
}

function RetentionCellValue({
  cell,
  cohortSize,
}: {
  cell: RetentionCell | undefined;
  cohortSize: number;
}) {
  if (!cell) {
    return <td aria-hidden="true" />;
  }

  return (
    <td
      style={{
        backgroundColor: `color-mix(in srgb, var(--primary) ${getCellIntensity(cell)}%, transparent)`,
        textAlign: "center",
      }}
    >
      <Tooltip content={`${cell.count} of ${cohortSize} active`}>
        <span>{cell.pct}%</span>
      </Tooltip>
    </td>
  );
}

/**
 * Weekly retention cohort grid. Each row is a cohort (users grouped by the week
 * of their first activity); each cell is the share of that cohort still active
 * `n` weeks later, shaded by intensity. SSR-only — no client JS.
 */
export function RetentionTable({ cohorts }: RetentionTableProps) {
  const nonEmpty = getNonEmptyCohorts(cohorts);
  if (nonEmpty.length === 0) {
    return <p className="muted">No retention data for this period yet.</p>;
  }
  const maxWeeks = getMaxWeekCount(nonEmpty);

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
            {Array.from({ length: maxWeeks }, (_, weekIndex) => (
              <th key={weekIndex} scope="col">
                W{weekIndex}
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
              {Array.from({ length: maxWeeks }, (_, weekIndex) => (
                <RetentionCellValue
                  key={weekIndex}
                  cell={cohort.cells[weekIndex]}
                  cohortSize={cohort.size}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </AdminTableWrap>
    </Card>
  );
}
