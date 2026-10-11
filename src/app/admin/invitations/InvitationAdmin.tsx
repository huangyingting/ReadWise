"use client";

import { FormEvent, useState } from "react";
import { Copy, MailPlus, RefreshCw, UserX } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FormActions,
  Input,
  Stack,
} from "@/components/ui";
import { AdminTableWrap } from "@/components/admin";
import { accountAdmissionRequest } from "@/lib/account-admission/client";
import { AuthNotice } from "@/components/auth/AuthShell";

type Invitation = {
  id: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  invitedBy?: { id: string; name: string | null } | null;
  acceptedBy?: { id: string; name: string | null } | null;
};

type InvitationMutation = {
  invitation: Invitation;
  acceptUrl?: string;
  delivery?: { delivered: boolean; reason?: string };
};

const STATUS_VARIANT = {
  PENDING: "warning",
  ACCEPTED: "success",
  REVOKED: "danger",
  EXPIRED: "neutral",
} as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function InvitationAdmin({
  initialInvitations,
}: {
  initialInvitations: Invitation[];
}) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [pending, setPending] = useState(false);
  const [rowPending, setRowPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function mergeInvitation(invitation: Invitation) {
    setInvitations((current) => {
      const exists = current.some((item) => item.id === invitation.id);
      return exists
        ? current.map((item) =>
            item.id === invitation.id ? { ...item, ...invitation } : item,
          )
        : [invitation, ...current];
    });
  }

  function showMutation(result: InvitationMutation) {
    mergeInvitation(result.invitation);
    if (result.acceptUrl) {
      setLatestLink(result.acceptUrl);
      setCopied(false);
    }
    setDeliveryMessage(
      result.delivery?.delivered
        ? "The invitation email was sent."
        : "Email was not sent. Copy and share the one-time link securely.",
    );
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError("");
    setLatestLink("");
    setDeliveryMessage("");
    const form = new FormData(formElement);
    const rawExpiry = String(form.get("expiresAt") ?? "");
    try {
      const result = await accountAdmissionRequest<InvitationMutation>(
        "/api/admin/invitations",
        {
          email: String(form.get("email") ?? ""),
          expiresAt: rawExpiry
            ? new Date(rawExpiry).toISOString()
            : undefined,
        },
      );
      showMutation(result);
      formElement.reset();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The invitation could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  async function rotateInvitation(id: string) {
    setRowPending(id);
    setError("");
    try {
      const result = await accountAdmissionRequest<InvitationMutation>(
        `/api/admin/invitations/${encodeURIComponent(id)}/rotate`,
        {},
      );
      showMutation(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The invitation link could not be rotated.",
      );
    } finally {
      setRowPending(null);
    }
  }

  async function revokeInvitation(id: string) {
    setRowPending(id);
    setError("");
    try {
      const result = await accountAdmissionRequest<InvitationMutation>(
        `/api/admin/invitations/${encodeURIComponent(id)}`,
        undefined,
        "DELETE",
      );
      mergeInvitation(result.invitation);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The invitation could not be revoked.",
      );
    } finally {
      setRowPending(null);
    }
  }

  async function copyLatestLink() {
    try {
      await navigator.clipboard.writeText(latestLink);
      setCopied(true);
    } catch {
      setError("Copy failed. Select and copy the link manually.");
    }
  }

  return (
    <Stack gap="6">
      <form onSubmit={createInvitation}>
        <Stack gap="3">
          <div className="grid gap-[var(--space-3)] md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
            <Field label="Email" required>
              <Input
                name="email"
                type="email"
                autoComplete="off"
                maxLength={320}
                required
              />
            </Field>
            <Field
              label="Expiry (optional)"
              hint="Leave blank for seven days, or choose a custom date and time."
            >
              <Input name="expiresAt" type="datetime-local" />
            </Field>
          </div>
          <FormActions align="start">
            <Button
              type="submit"
              loading={pending}
              leadingIcon={<MailPlus size={16} aria-hidden />}
            >
              Create invitation
            </Button>
          </FormActions>
        </Stack>
      </form>

      {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}

      {latestLink ? (
        <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-[var(--space-4)]">
          <Stack gap="3">
            <div>
              <div className="font-semibold text-success-text">
                Invitation link created
              </div>
              <p className="text-[length:var(--text-sm)] text-text-muted">
                {deliveryMessage} This link is shown only for this response.
              </p>
            </div>
            <div className="flex flex-col gap-[var(--space-2)] sm:flex-row">
              <Input
                value={latestLink}
                readOnly
                aria-label="Invitation link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="secondary"
                onClick={copyLatestLink}
                leadingIcon={<Copy size={16} aria-hidden />}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </Stack>
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <EmptyState
          icon={MailPlus}
          title="No invitations yet"
          description="Create an invitation to admit the first reader."
        />
      ) : (
        <AdminTableWrap ariaLabel="Account invitations table (scrollable)">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Expires</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>
                  <Badge variant={STATUS_VARIANT[invitation.status]}>
                    {invitation.status.toLowerCase()}
                  </Badge>
                </td>
                <td className="muted">{formatDate(invitation.createdAt)}</td>
                <td className="muted">{formatDate(invitation.expiresAt)}</td>
                <td>
                  {invitation.status === "PENDING" ? (
                    <div className="flex flex-wrap gap-[var(--space-2)]">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={rowPending === invitation.id}
                        disabled={rowPending !== null}
                        leadingIcon={<RefreshCw size={14} aria-hidden />}
                        onClick={() => rotateInvitation(invitation.id)}
                      >
                        Rotate
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        disabled={rowPending !== null}
                        leadingIcon={<UserX size={14} aria-hidden />}
                        onClick={() => revokeInvitation(invitation.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[length:var(--text-sm)] text-text-subtle">
                      No actions
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}
    </Stack>
  );
}
