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

function levelRange(min: string | null, max: string | null): string | null {
  if (min && max) return min === max ? min : `${min}–${max}`;
  return min ?? max ?? null;
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
          {series.map((s) => {
            const range = levelRange(s.targetLevelMin, s.targetLevelMax);
            const enrolled =
              s.enrollment !== null && s.enrollment.status !== "completed";
            const completed = s.enrollment?.status === "completed";
            return (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle>{s.title}</CardTitle>
                  <CardMeta>
                    {s.articleCount} article{s.articleCount !== 1 ? "s" : ""}
                  </CardMeta>
                </CardHeader>
                {s.description && <CardBody>{s.description}</CardBody>}
                <CardFooter className="justify-between">
                  <Inline>
                    {range && <Badge variant="primary" uppercase>{range}</Badge>}
                    {s.topic && <Badge variant="neutral">{s.topic}</Badge>}
                    {completed && (
                      <Badge variant="success">{t("series.status.completed")}</Badge>
                    )}
                  </Inline>
                  <SeriesEnrollButton seriesId={s.id} enrolled={enrolled} />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
