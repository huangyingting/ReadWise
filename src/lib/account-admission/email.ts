import type { Prisma } from "@prisma/client";
import { accountMailWorkflowConfig } from "@/lib/runtime-config/account-admission";
import {
  queueAccountMail,
  type AccountMail,
} from "./account-mail-outbox";
import { accountAdmissionSecretLink } from "./links";

export type EmailDeliveryResult =
  | { queued: true }
  | {
      queued: false;
      reason: "email_not_configured" | "invalid_app_url";
    };

type MailClient = Pick<Prisma.TransactionClient, "accountEmailOutbox">;

type SecretLinkEmail = {
  email: string;
  token: string;
  expiresAt: Date;
};

async function queueSecretLinkEmail(
  tx: MailClient,
  input: SecretLinkEmail & {
    subject: string;
    intro: string;
    linkLabel: string;
    path: string;
    context: Omit<AccountMail, "to" | "subject" | "body">;
  },
): Promise<EmailDeliveryResult> {
  if (!accountMailWorkflowConfig.isConfigured()) {
    return { queued: false, reason: "email_not_configured" };
  }
  const link = accountAdmissionSecretLink(input.path, input.token);
  if (!link) {
    return { queued: false, reason: "invalid_app_url" };
  }
  const body = `${input.intro}\n\n${input.linkLabel}: ${link}\n\nIf you did not request this, you can ignore this email.`;
  await queueAccountMail(
    tx,
    {
      to: input.email,
      subject: input.subject,
      body,
      ...input.context,
    } as AccountMail,
    input.expiresAt,
  );
  return { queued: true };
}

export function queueAccountInvitationEmail(
  tx: MailClient,
  input: SecretLinkEmail & {
    invitationId: string;
    invitationTokenHash: string;
  },
): Promise<EmailDeliveryResult> {
  return queueSecretLinkEmail(tx, {
    ...input,
    subject: "You are invited to ReadWise",
    intro: "An administrator invited you to create a ReadWise account.",
    linkLabel: "Accept invitation",
    path: "/invite",
    context: {
      invitationId: input.invitationId,
      invitationTokenHash: input.invitationTokenHash,
    },
  });
}

export function queueRegistrationVerificationEmail(
  tx: MailClient,
  input: SecretLinkEmail & { registrationHash: string },
): Promise<EmailDeliveryResult> {
  return queueSecretLinkEmail(tx, {
    ...input,
    subject: "Verify your ReadWise email",
    intro: "Confirm your email address to finish creating your ReadWise account.",
    linkLabel: "Verify email",
    path: "/verify-email",
    context: { registrationHash: input.registrationHash },
  });
}

export function queuePasswordResetEmail(
  tx: MailClient,
  input: SecretLinkEmail & { passwordResetHash: string },
): Promise<EmailDeliveryResult> {
  return queueSecretLinkEmail(tx, {
    ...input,
    subject: "Reset your ReadWise password",
    intro: "Use this single-use link to choose a new ReadWise password.",
    linkLabel: "Reset password",
    path: "/reset-password",
    context: { passwordResetHash: input.passwordResetHash },
  });
}
