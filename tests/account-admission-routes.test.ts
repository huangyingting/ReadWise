/**
 * Account Admission HTTP routes: password sign-in and recovery, invitation and
 * public registration, email verification, authentication methods, and the
 * admin invitation lifecycle. Handlers run through passthrough wrappers with
 * the admission library, audit trail, and session cookie scripted.
 */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

class MockApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Handler = (ctx: Record<string, unknown>) => Promise<Response>;
const passthroughHandler = (_config: unknown, handler: Handler) => handler;
const passthroughCapabilityHandler = (_capability: unknown, _config: unknown, handler: Handler) =>
  handler;

const session = { user: { id: "admin-1", role: "Admin", email: "admin@example.test" } };
const req = new Request("https://readwise.example.test/api");
const requestId = "req-1";

const invitation = {
  id: "inv-1",
  email: "reader@example.test",
  status: "PENDING",
  expiresAt: new Date("2026-12-01T00:00:00Z"),
  createdAt: new Date("2026-11-01T00:00:00Z"),
  acceptedAt: null,
  revokedAt: null,
};

let mode = "invitation-only";
let mailConfigured = true;
let secretLink: string | null = "https://readwise.example.test/invite/token";
let authenticated: { session: { sessionToken: string } } | null = null;
let calls: Array<[string, ...unknown[]]> = [];
let audits: Array<Record<string, unknown>> = [];
let cookies: unknown[] = [];

function record(name: string) {
  return async (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
}

before(() => {
  mock.module("@/lib/api-handler", {
    namedExports: {
      ApiError: MockApiError,
      createHandler: passthroughHandler,
      createPublicHandler: passthroughHandler,
      createCapabilityHandler: passthroughCapabilityHandler,
    },
  });
  mock.module("@/lib/account-admission", {
    namedExports: {
      accountAdmissionMode: () => mode,
      accountAdmissionSecretLink: (path: string, token: string, base: string) => {
        calls.push(["secretLink", path, token, base]);
        return secretLink;
      },
      enforceAccountAdmissionRateLimit: record("rateLimit"),
      authenticatePassword: async (input: unknown) => {
        calls.push(["authenticatePassword", input]);
        return authenticated;
      },
      requestPasswordReset: record("requestPasswordReset"),
      resetPassword: record("resetPassword"),
      inspectAccountInvitation: async (token: string) => {
        calls.push(["inspectAccountInvitation", token]);
        return { id: "inv-1", status: "pending", maskedEmail: "re***@example.test", expiresAt: null };
      },
      registerWithInvitation: async (input: unknown) => {
        calls.push(["registerWithInvitation", input]);
        return { session: { sessionToken: "invited-session" } };
      },
      beginPublicRegistration: record("beginPublicRegistration"),
      completePublicRegistration: async (token: string) => {
        calls.push(["completePublicRegistration", token]);
        return { session: { sessionToken: "verified-session" } };
      },
      listAuthenticationMethods: async (userId: string) => ({ hasPassword: true, providers: [userId] }),
      setPasswordForUser: async (input: unknown) => {
        calls.push(["setPasswordForUser", input]);
        return { userId: "admin-1", created: true };
      },
      listAccountInvitations: async () => [invitation],
      createAccountInvitation: async (input: unknown) => {
        calls.push(["createAccountInvitation", input]);
        return { invitation, token: "token", delivery: { queued: true } };
      },
      rotateAccountInvitation: async (id: string, expiresAt?: Date) => {
        calls.push(["rotateAccountInvitation", id, expiresAt]);
        return {
          invitation,
          token: "rotated",
          delivery: { queued: false, reason: "email_not_configured" },
        };
      },
      revokeAccountInvitation: async (id: string) => ({ ...invitation, id, status: "REVOKED" }),
    },
  });
  mock.module("@/lib/runtime-config/account-admission", {
    namedExports: { accountMailWorkflowConfig: { isConfigured: () => mailConfigured } },
  });
  mock.module("@/lib/auth/session-cookie", {
    namedExports: {
      setDatabaseSessionCookie: (_response: Response, value: unknown) => cookies.push(value),
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminAccountInvitationCreate: "admin.account_invitation.create",
        adminAccountInvitationRotate: "admin.account_invitation.rotate",
        adminAccountInvitationRevoke: "admin.account_invitation.revoke",
      },
      recordAuditFromRequest: async (entry: Record<string, unknown>) => audits.push(entry),
    },
  });
});

beforeEach(() => {
  mode = "invitation-only";
  mailConfigured = true;
  secretLink = "https://readwise.example.test/invite/token";
  authenticated = null;
  calls = [];
  audits = [];
  cookies = [];
});

/** Handler context; cast because the exported handlers are typed as Next route handlers. */
function ctx(overrides: Record<string, unknown> = {}) {
  return { req, session, requestId, ...overrides } as never;
}

async function rejectsWith(action: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(action, (error: unknown) => {
    const failure = error as { status?: number; code?: string };
    assert.equal(failure.status, status);
    if (code) assert.equal(failure.code, code);
    return true;
  });
}

test("password sign-in sets a session cookie only for valid credentials", async () => {
  const { POST } = await import("@/app/api/auth/password/login/route");
  const body = { email: "reader@example.test", password: "correct horse battery staple" };

  await rejectsWith(POST(ctx({ body })), 401);
  assert.deepEqual(cookies, []);

  authenticated = { session: { sessionToken: "password-session" } };
  const response = await POST(ctx({ body }));
  assert.equal(response.status, 200);
  assert.deepEqual(cookies, [{ sessionToken: "password-session" }]);
  assert.deepEqual(calls[0], ["rateLimit", req, body.email]);
});

test("password recovery accepts requests without revealing accounts and resets with a token", async () => {
  const forgot = await import("@/app/api/auth/password/forgot/route");
  const reset = await import("@/app/api/auth/password/reset/route");

  const accepted = await forgot.POST(ctx({ body: { email: "anyone@example.test" } }));
  assert.equal(accepted.status, 202);
  assert.match((await accepted.json()).message, /If a password account exists/);

  const body = { token: "reset-token", password: "a new secure password" };
  assert.equal((await reset.POST(ctx({ body }))).status, 200);
  assert.deepEqual(calls.at(-1), ["resetPassword", body]);
});

test("invitation inspection and email verification go through the admission service", async () => {
  const invitationRoute = await import("@/app/api/auth/invitation/route");
  const verifyRoute = await import("@/app/api/auth/verify-email/route");

  const inspected = await invitationRoute.POST(ctx({ body: { token: "invite-token" } }));
  assert.equal((await inspected.json()).invitation.status, "pending");

  const verified = await verifyRoute.POST(ctx({ body: { token: "verify-token" } }));
  assert.equal(verified.status, 201);
  assert.deepEqual(cookies, [{ sessionToken: "verified-session" }]);
});

test("registration requires an invitation, or working mail delivery in public mode", async () => {
  const { POST } = await import("@/app/api/auth/register/route");
  const body = { email: "reader@example.test", password: "correct horse battery staple", name: "Reader" };

  await rejectsWith(POST(ctx({ body })), 403, "invitation_required");
  const invited = await POST(ctx({ body: { ...body, token: "invite-token" } }));
  assert.equal(invited.status, 201);
  assert.deepEqual(cookies, [{ sessionToken: "invited-session" }]);

  mode = "public";
  mailConfigured = false;
  await rejectsWith(POST(ctx({ body })), 503, "email_unavailable");
  mailConfigured = true;
  const pending = await POST(ctx({ body }));
  assert.equal(pending.status, 202);
  assert.deepEqual(calls.at(-1), ["beginPublicRegistration", body]);
});

test("authentication methods are listed and a password can be added", async () => {
  const { GET, PUT } = await import("@/app/api/account/auth-methods/route");

  assert.deepEqual(await (await GET(ctx())).json(), { hasPassword: true, providers: ["admin-1"] });

  const body = { currentPassword: "old secure password", password: "a new secure password" };
  assert.deepEqual(await (await PUT(ctx({ body }))).json(), { ok: true, created: true });
  assert.deepEqual(calls.at(-1), ["setPasswordForUser", { userId: "admin-1", ...body }]);
});

test("admins list and create invitations in invitation-only mode with an audited link", async () => {
  const { GET, POST } = await import("@/app/api/admin/invitations/route");

  const listed = await (await GET(ctx())).json();
  assert.equal(listed.invitations[0].id, "inv-1");

  const created = await POST(ctx({ body: { email: "reader@example.test", expiresAt: "2026-12-01T00:00:00Z" } }));
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.acceptUrl, secretLink);
  assert.equal(payload.invitation.acceptedAt, null);
  assert.equal((calls.find(([name]) => name === "createAccountInvitation")?.[1] as { expiresAt: Date }).expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(audits[0]?.action, "admin.account_invitation.create");
  assert.deepEqual(audits[0]?.metadata, {
    queued: true,
    deliveryOutcome: "queued",
    expiresAt: invitation.expiresAt.toISOString(),
  });

  await rejectsWith(POST(ctx({ body: { email: "reader@example.test", expiresAt: "not a date" } })), 400, "invalid_expiry");
  secretLink = null;
  await rejectsWith(POST(ctx({ body: { email: "reader@example.test" } })), 503, "public_url_unavailable");

  mode = "public";
  await rejectsWith(GET(ctx()), 409, "mode_mismatch");
  await rejectsWith(POST(ctx({ body: { email: "reader@example.test" } })), 409, "mode_mismatch");
});

test("admins rotate and revoke invitations with audit records", async () => {
  const rotate = await import("@/app/api/admin/invitations/[id]/rotate/route");
  const revoke = await import("@/app/api/admin/invitations/[id]/route");
  const params = { id: "inv-1" };

  const rotated = await (await rotate.POST(ctx({ params, body: {} }))).json();
  assert.equal(rotated.acceptUrl, secretLink);
  assert.equal(rotated.delivery.reason, "email_not_configured");
  assert.deepEqual(calls.find(([name]) => name === "rotateAccountInvitation"), ["rotateAccountInvitation", "inv-1", undefined]);
  assert.equal(audits[0]?.action, "admin.account_invitation.rotate");
  assert.equal((audits[0]?.metadata as { deliveryOutcome: string }).deliveryOutcome, "email_not_configured");

  await rotate.POST(ctx({ params, body: { expiresAt: "2026-12-24T00:00:00Z" } }));
  assert.equal((calls.filter(([name]) => name === "rotateAccountInvitation")[1]?.[2] as Date).toISOString(), "2026-12-24T00:00:00.000Z");
  await rejectsWith(rotate.POST(ctx({ params, body: { expiresAt: "soon" } })), 400, "invalid_expiry");
  secretLink = null;
  await rejectsWith(rotate.POST(ctx({ params, body: {} })), 503, "public_url_unavailable");

  const revoked = await (await revoke.DELETE(ctx({ params }))).json();
  assert.equal(revoked.invitation.status, "REVOKED");
  assert.equal(audits.at(-1)?.action, "admin.account_invitation.revoke");
});
