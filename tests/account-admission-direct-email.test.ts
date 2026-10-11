import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let mxRecords: Array<{ priority: number; exchange: string }> = [];
let mxAddresses: Array<{ address: string; family: number }> = [];
let sentResult: unknown;
let sentError: unknown;
let transportOptions: Record<string, unknown> | null = null;
let sentMessage: Record<string, unknown> | null = null;
let closeCalls = 0;

before(() => {
  mock.module("node:dns/promises", {
    namedExports: {
      resolveMx: async () => mxRecords,
      lookup: async () => mxAddresses,
    },
  });
  mock.module("nodemailer10", {
    defaultExport: {
      createTransport: (options: Record<string, unknown>) => {
        transportOptions = options;
        return {
          sendMail: async (message: Record<string, unknown>) => {
            sentMessage = message;
            if (sentError) throw sentError;
            return sentResult;
          },
          close: () => {
            closeCalls += 1;
          },
        };
      },
    },
  });
});

beforeEach(() => {
  mxRecords = [
    { priority: 20, exchange: "mx2.example.test" },
    { priority: 10, exchange: "mx1.example.test" },
  ];
  mxAddresses = [{ address: "8.8.8.8", family: 4 }];
  sentResult = { accepted: ["person@example.test"] };
  sentError = null;
  transportOptions = null;
  sentMessage = null;
  closeCalls = 0;
});

const config = {
  kind: "direct" as const,
  from: "noreply@readwise.example.test",
  selector: "readwise-test",
  privateKey: "test-private-key",
};

const message = {
  to: "person@example.test",
  subject: "ReadWise invitation",
  text: "Accept your invitation.",
};

test("direct email uses verified STARTTLS, DKIM, and one envelope recipient", async () => {
  const { sendDirectEmail } = await import("@/lib/account-admission/direct-email");

  assert.equal(await sendDirectEmail(message, config), "sent");
  assert.deepEqual(transportOptions, {
    host: "8.8.8.8",
    port: 25,
    secure: false,
    requireTLS: true,
    name: "readwise.example.test",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: {
      rejectUnauthorized: true,
      servername: "mx1.example.test",
    },
    dkim: {
      domainName: "readwise.example.test",
      keySelector: "readwise-test",
      privateKey: "test-private-key",
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  assert.deepEqual(sentMessage?.envelope, {
    from: config.from,
    to: [message.to],
  });
  assert.equal(closeCalls, 1);
});

test("direct email reports ambiguous post-DATA failures as unconfirmed", async () => {
  sentError = Object.assign(new Error("Lost acknowledgement"), {
    code: "ESOCKET",
    command: "DATA",
  });
  const { sendDirectEmail } = await import("@/lib/account-admission/direct-email");

  assert.equal(await sendDirectEmail(message, config), "unconfirmed");
  assert.equal(closeCalls, 1);
});

test("direct email reports explicit recipient refusal as failed", async () => {
  sentError = Object.assign(new Error("Recipient refused"), {
    responseCode: 550,
  });
  const { sendDirectEmail } = await import("@/lib/account-admission/direct-email");

  assert.equal(await sendDirectEmail(message, config), "failed");
});

test("direct email rejects null MX, header injection, and mixed public addresses", async () => {
  const { sendDirectEmail } = await import("@/lib/account-admission/direct-email");

  mxRecords = [{ priority: 0, exchange: "." }];
  assert.equal(await sendDirectEmail(message, config), "failed");
  assert.equal(transportOptions, null);

  await assert.rejects(
    sendDirectEmail(
      { ...message, subject: "Invitation\r\nBcc: victim@example.test" },
      config,
    ),
    /invalid direct email/i,
  );

  mxRecords = [{ priority: 10, exchange: "mx1.example.test" }];
  mxAddresses = [
    { address: "8.8.8.8", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ];
  assert.equal(await sendDirectEmail(message, config), "failed");
  assert.equal(transportOptions, null);
});
