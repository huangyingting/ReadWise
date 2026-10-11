import { MailPlus } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin";
import { accountAdmissionMode, listAccountInvitations } from "@/lib/account-admission";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import InvitationAdmin from "./InvitationAdmin";

export default async function AdminInvitationsPage() {
  await requireCapability(CAPABILITIES.membersManage, "/admin/invitations");
  if (accountAdmissionMode() !== "invitation-only") {
    return (
      <section className="stack">
        <AdminPageHeader>Invitations</AdminPageHeader>
        <EmptyState
          icon={MailPlus}
          title="Public registration is enabled"
          description="Account invitations are disabled while anyone can verify an email and register."
        />
      </section>
    );
  }

  const invitations = (await listAccountInvitations()).map((invitation) => ({
    ...invitation,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  }));

  return (
    <section className="stack">
      <AdminPageHeader>Invitations</AdminPageHeader>
      <InvitationAdmin initialInvitations={invitations} />
    </section>
  );
}
