import NodemailerImport from "nodemailer";
import type { Transporter } from "nodemailer";
import { createLogger } from "@/lib/observability/logger";
import { emailDeliveryConfig } from "@/lib/runtime-config/account-admission";
import { accountAdmissionSecretLink } from "./links";

type DefaultInterop<T> = { default: T };

function hasDefaultInterop<T>(value: T | DefaultInterop<T>): value is DefaultInterop<T> {
  return typeof value === "object" && value !== null && "default" in value;
}

const nodemailer = hasDefaultInterop(NodemailerImport)
  ? NodemailerImport.default
  : NodemailerImport;
const logger = createLogger("account-admission-email");

export type EmailDeliveryResult =
  | { delivered: true }
  | {
      delivered: false;
      reason: "email_not_configured" | "invalid_app_url" | "delivery_failed";
    };

type SecretLinkEmail = {
  email: string;
  token: string;
};

let cachedTransport:
  | { smtpUrl: string; transport: Transporter }
  | null = null;

function transportFor(smtpUrl: string): Transporter {
  if (cachedTransport?.smtpUrl === smtpUrl) return cachedTransport.transport;
  const transport = nodemailer.createTransport(smtpUrl);
  cachedTransport = { smtpUrl, transport };
  return transport;
}

async function sendSecretLinkEmail(input: {
  email: string;
  subject: string;
  intro: string;
  linkLabel: string;
  link: string | null;
}): Promise<EmailDeliveryResult> {
  const config = emailDeliveryConfig.get();
  if (!config) {
    return { delivered: false, reason: "email_not_configured" };
  }
  if (!input.link) {
    return { delivered: false, reason: "invalid_app_url" };
  }

  try {
    await transportFor(config.smtpUrl).sendMail({
      from: config.from,
      to: input.email,
      subject: input.subject,
      text: `${input.intro}\n\n${input.linkLabel}: ${input.link}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>${input.intro}</p><p><a href="${input.link}">${input.linkLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });
    return { delivered: true };
  } catch {
    logger.error("email.delivery_failed", {
      machineReason: "account_admission_email_delivery_failed",
    });
    return { delivered: false, reason: "delivery_failed" };
  }
}

export function sendAccountInvitationEmail(
  input: SecretLinkEmail,
): Promise<EmailDeliveryResult> {
  return sendSecretLinkEmail({
    email: input.email,
    subject: "You are invited to ReadWise",
    intro: "An administrator invited you to create a ReadWise account.",
    linkLabel: "Accept invitation",
    link: accountAdmissionSecretLink("/invite", input.token),
  });
}

export function sendRegistrationVerificationEmail(
  input: SecretLinkEmail,
): Promise<EmailDeliveryResult> {
  return sendSecretLinkEmail({
    email: input.email,
    subject: "Verify your ReadWise email",
    intro: "Confirm your email address to finish creating your ReadWise account.",
    linkLabel: "Verify email",
    link: accountAdmissionSecretLink("/verify-email", input.token),
  });
}

export function sendPasswordResetEmail(
  input: SecretLinkEmail,
): Promise<EmailDeliveryResult> {
  return sendSecretLinkEmail({
    email: input.email,
    subject: "Reset your ReadWise password",
    intro: "Use this single-use link to choose a new ReadWise password.",
    linkLabel: "Reset password",
    link: accountAdmissionSecretLink("/reset-password", input.token),
  });
}
