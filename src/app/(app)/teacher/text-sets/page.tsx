import Link from "next/link";
import { Library, Plus } from "lucide-react";
import { requireSession } from "@/lib/session";
import {
  listTextSetOrganizations,
  listTextSetsForViewer,
  type TextSetSummary,
} from "@/lib/classroom/text-sets";
import { formatMediumDate } from "@/lib/display-format";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  PageShell,
  buttonVariants,
} from "@/components/ui";
import { cn } from "@/lib/cn";

type Tab = "mine" | "shared";

function TextSetCard({ set, showOwner }: { set: TextSetSummary; showOwner: boolean }) {
  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-[var(--space-1)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Link href={`/teacher/text-sets/${encodeURIComponent(set.id)}`} className="font-medium text-text hover:underline">
              {set.title}
            </Link>
            <Badge variant={set.visibility === "ORG" ? "primary" : "neutral"}>
              {set.visibility === "ORG" ? "Shared" : "Private"}
            </Badge>
          </div>
          {set.essentialQuestion ? (
            <p className="m-0 text-[length:var(--type-ui)] text-text">{set.essentialQuestion}</p>
          ) : null}
          <p className="m-0 text-[length:var(--type-label)] text-text-muted">
            {set.itemCount} {set.itemCount === 1 ? "reading" : "readings"} · {set.organizationName}
            {showOwner && set.ownerName ? ` · by ${set.ownerName}` : ""} · updated {formatMediumDate(set.updatedAt)}
          </p>
        </CardBody>
      </Card>
    </li>
  );
}

/** Teacher Text Sets workspace (#1308): my sets and sets shared at my organizations. */
export default async function TextSetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession("/teacher/text-sets");
  const tab: Tab = (await searchParams).tab === "shared" ? "shared" : "mine";
  const organizations = await listTextSetOrganizations(session.user);

  if (organizations.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Text sets" description="Curated groups of readings for a unit." />
        <EmptyState
          icon={Library}
          title="Text sets are for teachers"
          description="Join an organization as a teacher to create and share text sets."
          action={{ href: "/teacher", label: "Back to teaching" }}
        />
      </PageShell>
    );
  }

  const { mine, shared } = await listTextSetsForViewer(session.user);
  const sets = tab === "mine" ? mine : shared;

  return (
    <PageShell>
      <PageHeader
        title="Text sets"
        description="Group readings around an essential question, share them with colleagues, and assign them as a unit."
        actions={
          <Link href="/teacher/text-sets/new" className={buttonVariants({ size: "sm" })}>
            <Plus size={14} aria-hidden />
            New text set
          </Link>
        }
      />
      <nav aria-label="Text set lists" className="mb-[var(--space-4)] flex gap-[var(--space-2)]">
        {(
          [
            ["mine", `Created by me (${mine.length})`],
            ["shared", `Shared at my organization (${shared.length})`],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "mine" ? "/teacher/text-sets" : "/teacher/text-sets?tab=shared"}
            aria-current={tab === key ? "page" : undefined}
            className={cn(buttonVariants({ variant: tab === key ? "secondary" : "ghost", size: "sm" }))}
          >
            {label}
          </Link>
        ))}
      </nav>
      {sets.length === 0 ? (
        <EmptyState
          icon={Library}
          title={tab === "mine" ? "No text sets yet" : "Nothing shared yet"}
          description={
            tab === "mine"
              ? "Create a text set to group readings around an essential question."
              : "Text sets your colleagues share with the organization appear here."
          }
          action={tab === "mine" ? { href: "/teacher/text-sets/new", label: "New text set" } : undefined}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
          {sets.map((set) => (
            <TextSetCard key={set.id} set={set} showOwner={tab === "shared"} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
