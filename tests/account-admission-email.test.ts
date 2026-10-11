import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let sentMessages: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("nodemailer", {
    defaultExport: {
      createTransport: () => ({
        sendMail: async (message: Record<string, unknown>) => {
          sentMessages.push(message);
          return { messageId: "message-1" };
        },
      }),
    },
  });
});

beforeEach(() => {
  sentMessages = [];
  delete process.env.SMTP_URL;
  delete process.env.EMAIL_FROM;
  process.env.NEXTAUTH_URL = "https://readwise.example.test";
});

test("invitation email delivery degrades explicitly when SMTP is absent", async () => {
  const { sendAccountInvitationEmail } = await import("@/lib/account-admission/email");
  const result = await sendAccountInvitationEmail({
    email: "reader@example.test",
    token: "invite-token",
  });

  assert.deepEqual(result, {
    delivered: false,
    reason: "email_not_configured",
  });
  assert.equal(sentMessages.length, 0);
});

test("verification and reset emails use single-purpose secret links", async () => {
  process.env.SMTP_URL = "smtps://mailer.example.test:465";
  process.env.EMAIL_FROM = "ReadWise <noreply@example.test>";
  const {
    sendPasswordResetEmail,
    sendRegistrationVerificationEmail,
  } = await import("@/lib/account-admission/email");

  assert.deepEqual(
    await sendRegistrationVerificationEmail({
      email: "reader@example.test",
      token: "verify-token",
    }),
    { delivered: true },
  );
  assert.deepEqual(
    await sendPasswordResetEmail({
      email: "reader@example.test",
      token: "reset-token",
    }),
    { delivered: true },
  );

  assert.equal(sentMessages.length, 2);
  assert.match(String(sentMessages[0]?.text), /verify-email\/verify-token/);
  assert.match(String(sentMessages[1]?.text), /reset-password\/reset-token/);
  assert.doesNotMatch(String(sentMessages[0]?.text), /reset-token/);
  assert.doesNotMatch(String(sentMessages[1]?.text), /verify-token/);
});
