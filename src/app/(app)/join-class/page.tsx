import { requireSession } from "@/lib/session";
import { Card, CardBody, PageHeader, PageShell } from "@/components/ui";
import JoinClassForm from "@/components/JoinClassForm";
import { JOIN_CODE_INPUT_MAX_LENGTH } from "@/lib/classroom/join-code-format";

type SearchParams = { code?: string | string[] };

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.slice(0, JOIN_CODE_INPUT_MAX_LENGTH) ?? "";
}

/**
 * Self-service class enrollment (#1309). Teachers share a join code or a
 * `/join-class?code=…` link; signed-out visitors return here after sign-in
 * with the code still filled in.
 */
export default async function JoinClassPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const code = firstValue((await searchParams).code);
  await requireSession(code ? `/join-class?code=${encodeURIComponent(code)}` : "/join-class");

  return (
    <PageShell variant="narrow">
      <PageHeader title="Join a class" description="Enter the code your teacher shared to join their class." />
      <Card>
        <CardBody>
          <JoinClassForm initialCode={code} />
        </CardBody>
      </Card>
    </PageShell>
  );
}
