import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getTextSetForViewer, listAssignableClassrooms } from "@/lib/classroom/text-sets";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, PageShell } from "@/components/ui";
import TextSetEditor from "@/components/teacher/TextSetEditor";
import TextSetActions from "@/components/teacher/TextSetActions";

/**
 * A Text Set (#1308). Editors (owner; org admins for shared sets) get the
 * editor; other teachers in the org see a read-only view they can duplicate
 * or assign. Sets outside the viewer's organizations are not found.
 */
export default async function TextSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(`/teacher/text-sets/${encodeURIComponent(id)}`);
  const set = await getTextSetForViewer(id, session.user);
  if (!set) notFound();
  const classrooms = await listAssignableClassrooms(session.user, set.organizationId);

  return (
    <PageShell variant="narrow">
      <PageHeader
        title={set.title}
        description={`${set.organizationName}${set.ownerName ? ` · by ${set.ownerName}` : ""}`}
        actions={<Badge variant={set.visibility === "ORG" ? "primary" : "neutral"}>{set.visibility === "ORG" ? "Shared" : "Private"}</Badge>}
      />
      <div className="mb-[var(--space-5)]">
        <TextSetActions textSetId={set.id} canEdit={set.canEdit} classrooms={classrooms} />
      </div>
      {set.canEdit ? (
        <Card>
          <CardBody>
            <TextSetEditor organizations={[]} initial={set} />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{set.essentialQuestion ?? "Readings"}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-[var(--space-4)]">
            {set.description ? <p className="m-0 text-[length:var(--type-body)] text-text">{set.description}</p> : null}
            {set.educatorNotes ? (
              <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
                <span className="font-semibold">Teacher notes: </span>
                {set.educatorNotes}
              </p>
            ) : null}
            <ol className="m-0 flex flex-col gap-[var(--space-3)] pl-[var(--space-5)]">
              {set.items.map((item) => (
                <li key={item.articleId}>
                  <Link href={`/reader/${encodeURIComponent(item.articleId)}`} className="font-medium text-text hover:underline">
                    {item.title}
                  </Link>
                  {item.guidingNote ? (
                    <p className="m-0 text-[length:var(--type-ui)] text-text-muted">{item.guidingNote}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </PageShell>
  );
}
