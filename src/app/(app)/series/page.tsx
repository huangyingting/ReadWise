import { Library } from "lucide-react";
import type { Metadata } from "next";
import { requireOnboardedSession } from "@/lib/session";
import {
  PageShell,
  PageHeader,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  CardMeta,
  CardBody,
  CardFooter,
  Badge,
  Inline,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { listPublicSeriesForUser } from "@/lib/engagement/series";
import { SeriesEnrollButton } from "@/app/(app)/series/SeriesEnrollButton";

export const metadata: Metadata = {
  title: "Reading series",
  description: "Curated, leveled reading paths you can follow over multiple sessions.",
};

type PublicSeries = Awaited<ReturnType<typeof listPublicSeriesForUser>>[number];

function levelRange(min: string | null, max: string | null): string | null {
  if (min && max) return min === max ? min : `${min}–${max}`;
  return min ?? max ?? null;
}

function articleCountLabel(count: number): string {
  return `${count} article${count !== 1 ? "s" : ""}`;
}

function SeriesBrowserCard({ series }: { series: PublicSeries }) {
  const range = levelRange(series.targetLevelMin, series.targetLevelMax);
  const enrolled =
    series.enrollment !== null && series.enrollment.status !== "completed";
  const completed = series.enrollment?.status === "completed";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{series.title}</CardTitle>
        <CardMeta>{articleCountLabel(series.articleCount)}</CardMeta>
      </CardHeader>
      {series.description && <CardBody>{series.description}</CardBody>}
      <CardFooter className="justify-between">
        <Inline>
          {range && (
            <Badge variant="primary" uppercase>
              {range}
            </Badge>
          )}
          {series.topic && <Badge variant="neutral">{series.topic}</Badge>}
          {completed && (
            <Badge variant="success">{t("series.status.completed")}</Badge>
          )}
        </Inline>
        <SeriesEnrollButton seriesId={series.id} enrolled={enrolled} />
      </CardFooter>
    </Card>
  );
}

export default async function SeriesPage() {
  const session = await requireOnboardedSession("/series");
  const series = await listPublicSeriesForUser(session.user.id);

  return (
    <PageShell variant="listing">
      <PageHeader title={t("series.browser.title")} />

      {series.length === 0 ? (
        <EmptyState
          icon={Library}
          title={t("series.browser.title")}
          description={t("series.browser.empty")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
          {series.map((item) => (
            <SeriesBrowserCard key={item.id} series={item} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
