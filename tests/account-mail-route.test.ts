process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";

const workerSecret = "w".repeat(48);
let claimedMessages: Array<Record<string, string>> = [];
let acknowledgement:
  | { id: string; claimToken: string; status: string }
  | null = null;
let acknowledgeResult = true;
let previousEnabled: string | undefined;
let previousSecret: string | undefined;

before(() => {
  mock.module("@/lib/account-admission/account-mail-outbox", {
    namedExports: {
      claimAccountMail: async () => claimedMessages,
      acknowledgeAccountMail: async (
        id: string,
        claimToken: string,
        status: string,
      ) => {
        acknowledgement = { id, claimToken, status };
        return acknowledgeResult;
      },
    },
  });
});

afterEach(() => {
  claimedMessages = [];
  acknowledgement = null;
  acknowledgeResult = true;
  if (previousEnabled === undefined) {
    delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  } else {
    process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = previousEnabled;
  }
  if (previousSecret === undefined) {
    delete process.env.ACCOUNT_MAIL_WORKER_SECRET;
  } else {
    process.env.ACCOUNT_MAIL_WORKER_SECRET = previousSecret;
  }
});

async function postAccountMail(input: {
  secret?: string;
  query?: string;
  body?: unknown;
}) {
  const { POST } = await import("@/app/api/account-mail/tick/route");
  const headers = new Headers();
  if (input.secret) {
    headers.set("authorization", `Bearer ${input.secret}`);
  }
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return POST(
    new Request(
      `http://test/api/account-mail/tick${input.query ?? ""}`,
      {
        method: "POST",
        headers,
        body:
          input.body === undefined
            ? undefined
            : JSON.stringify(input.body),
      },
    ),
  );
}

function configureWorker(): void {
  previousEnabled = process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  previousSecret = process.env.ACCOUNT_MAIL_WORKER_SECRET;
  process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "true";
  process.env.ACCOUNT_MAIL_WORKER_SECRET = workerSecret;
}

test("account mail endpoint fails closed when unconfigured or unauthorized", async () => {
  previousEnabled = process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  previousSecret = process.env.ACCOUNT_MAIL_WORKER_SECRET;
  delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  delete process.env.ACCOUNT_MAIL_WORKER_SECRET;
  assert.equal(
    (await postAccountMail({ body: { operation: "claim" } })).status,
    503,
  );

  process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "true";
  process.env.ACCOUNT_MAIL_WORKER_SECRET = workerSecret;
  assert.equal(
    (
      await postAccountMail({
        secret: "wrong-secret",
        body: { operation: "claim" },
      })
    ).status,
    401,
  );
});

test("account mail configuration check sends no email", async () => {
  configureWorker();

  const response = await postAccountMail({
    secret: workerSecret,
    query: "?check=1",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    transport: "github-actions",
    configured: true,
    emailSent: false,
  });
});

test("account mail endpoint claims private payloads and strips validation metadata", async () => {
  configureWorker();
  claimedMessages = [
    {
      id: "mail-1",
      claimToken: "a".repeat(64),
      to: "reader@example.test",
      subject: "Invitation",
      body: "Private link",
      invitationId: "invitation-1",
      invitationTokenHash: "private-hash",
    },
  ];

  const response = await postAccountMail({
    secret: workerSecret,
    body: { operation: "claim" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    messages: [
      {
        id: "mail-1",
        claimToken: "a".repeat(64),
        to: "reader@example.test",
        subject: "Invitation",
        body: "Private link",
      },
    ],
  });
});

test("account mail acknowledgement is fenced by the active claim token", async () => {
  configureWorker();
  const body = {
    operation: "acknowledge",
    id: "mail-1",
    claimToken: "b".repeat(64),
    status: "sent",
  };

  const response = await postAccountMail({
    secret: workerSecret,
    body,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(acknowledgement, {
    id: "mail-1",
    claimToken: "b".repeat(64),
    status: "sent",
  });
  assert.deepEqual(await response.json(), { acknowledged: true });

  acknowledgeResult = false;
  assert.equal(
    (
      await postAccountMail({
        secret: workerSecret,
        body,
      })
    ).status,
    409,
  );
});

test("account mail endpoint bounds streamed request bodies without content-length", async () => {
  configureWorker();
  const { POST } = await import("@/app/api/account-mail/tick/route");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(4097)));
      controller.close();
    },
  });
  const response = await POST(
    new Request("http://test/api/account-mail/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerSecret}`,
        "content-type": "application/json",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );

  assert.equal(response.status, 413);
});

test("account mail endpoint rejects oversized, malformed, and unknown requests", async () => {
  configureWorker();
  const { POST } = await import("@/app/api/account-mail/tick/route");
  const rawPost = (body: string, headers: Record<string, string> = {}) =>
    POST(
      new Request("http://test/api/account-mail/tick", {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerSecret}`,
          "content-type": "application/json",
          ...headers,
        },
        body,
      }),
    );

  assert.equal((await rawPost("{}", { "content-length": "5000" })).status, 413);
  assert.equal((await rawPost("{not json")).status, 400);
  assert.equal((await rawPost("null")).status, 400);
  assert.equal((await rawPost(JSON.stringify({ id: "mail-1" }))).status, 400);
  assert.equal(
    (await postAccountMail({ secret: workerSecret, body: { operation: "unknown" } })).status,
    400,
  );
  assert.equal(
    (
      await postAccountMail({
        secret: workerSecret,
        body: { operation: "acknowledge", id: "mail-1", claimToken: "not-hex", status: "sent" },
      })
    ).status,
    400,
  );
  assert.equal(acknowledgement, null);
});
