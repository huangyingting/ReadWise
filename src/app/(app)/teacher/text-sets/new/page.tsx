import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { listTextSetOrganizations } from "@/lib/classroom/text-sets";
import { Card, CardBody, PageHeader, PageShell } from "@/components/ui";
import TextSetEditor from "@/components/teacher/TextSetEditor";

/** Create a Text Set (#1308) in an organization where the viewer teaches. */
export default async function NewTextSetPage() {
  const session = await requireSession("/teacher/text-sets/new");
  const organizations = await listTextSetOrganizations(session.user);
  if (organizations.length === 0) redirect("/teacher/text-sets");
  return (
    <PageShell variant="narrow">
      <PageHeader title="New text set" description="Frame a unit with an essential question and ordered readings." />
      <Card>
        <CardBody>
          <TextSetEditor organizations={organizations} />
        </CardBody>
      </Card>
    </PageShell>
  );
}
