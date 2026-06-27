import { notFound } from "next/navigation";
import { CalendarCheck, Compass } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { loadTodayViewModel } from "@/lib/engagement/today-session";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import {
  Badge,
  Card,
  EmptyState,
  Inline,
  PageHeader,
  PageShell,
  Section,
  Stack,
} from "@/components/ui";
import { today as todayMeta } from "@/lib/copy/pages";
import TodayWorkflow from "./_components/TodayWorkflow";
import TodayComprehensionCheck from "./_components/TodayComprehensionCheck";

export const metadata = todayMeta;

/** Friendly long-form local date, e.g. "Saturday, June 27". */
function formatLocalDate(localDate: string): string {
  const [y, m, d] = localDate.split("-").map((p) => Number.parseInt(p, 10));
  if (!y || !m || !d) return localDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TodayPage() {
  if (!isTodaySessionFeatureEnabled()) {
    notFound();
  }

  const session = await requireOnboardedSession("/today");
  const vm = await loadTodayViewModel({
    user: { id: session.user.id, role: session.user.role },
  });

  const primaryHref = vm.primaryArticle ? `/reader/${vm.primaryArticle.id}` : null;
  const readingComplete = vm.steps.reading.state === "complete";
  const isActive = vm.status === "active";

  return (
    <PageShell variant="listing">
      <PageHeader
        eyebrow={
          <Inline gap="2" align="center">
            <CalendarCheck size={16} aria-hidden className="text-text-muted" />
            <span>{formatLocalDate(vm.localDate)}</span>
          </Inline>
        }
        title="Today"
        description={vm.goalPathCopy.heading}
      />

      {vm.isNoCandidate ? (
        <EmptyState
          icon={Compass}
          title="No article picked for today yet"
          description="Browse the library or import an article to start today's reading."
          action={{ label: "Browse articles", href: "/browse" }}
        />
      ) : vm.status === "skipped" ? (
        <Stack gap="5">
          <Card>
            <Stack gap="3">
              <Badge variant="neutral">Skipped today</Badge>
              <p className="m-0 text-[length:var(--text-base)] text-text-muted">
                You skipped today&apos;s reading. Browse the library for something
                that fits your mood — your plan resets tomorrow.
              </p>
            </Stack>
          </Card>
          {vm.backups.length > 0 ? (
            <Section title="Other articles for you">
              <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
                {vm.backups.map((article) => (
                  <ArticleCardView
                    key={article.id}
                    article={article}
                    setTodayEnabled
                  />
                ))}
              </div>
            </Section>
          ) : (
            <EmptyState
              icon={Compass}
              title="Find something to read"
              description="Browse the library to pick your next article."
              action={{ label: "Browse articles", href: "/browse" }}
            />
          )}
        </Stack>
      ) : (
        <Stack gap="6">
          {vm.completedAt ? (
            <Card>
              <Stack gap="2">
                <Inline gap="2" align="center">
                  <Badge variant="success">Today complete</Badge>
                </Inline>
                <p className="m-0 text-[length:var(--text-base)] text-text-muted">
                  {vm.goalPathCopy.completion}
                </p>
              </Stack>
            </Card>
          ) : null}

          {vm.primaryArticle ? (
            <Section
              title={vm.source === "resume" ? "Pick up where you left off" : "Your article for today"}
            >
              <div className="grid grid-cols-1 gap-[var(--space-4)] sm:max-w-[var(--container-narrow)]">
                <ArticleCardView article={vm.primaryArticle} />
              </div>
              <ListingProgressSync articleIds={[vm.primaryArticle.id]} />
              <ListingBookmarkSync articleIds={[vm.primaryArticle.id]} />
            </Section>
          ) : (
            <EmptyState
              icon={Compass}
              title="Today's article isn't available"
              description="It may have been moved or unpublished. Browse for another article to read."
              action={{ label: "Browse articles", href: "/browse" }}
            />
          )}

          <TodayComprehensionCheck
            readingComplete={readingComplete}
            comprehensionComplete={vm.steps.comprehension.state === "complete"}
            active={isActive}
            userId={session.user.id}
            localDate={vm.localDate}
            timezone={vm.timezone}
          />

          <TodayWorkflow
            steps={vm.steps}
            active={isActive}
            readingComplete={readingComplete}
            primaryHref={primaryHref}
            completed={vm.completedAt != null}
            userId={session.user.id}
            localDate={vm.localDate}
            timezone={vm.timezone}
          />
        </Stack>
      )}
    </PageShell>
  );
}
