process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let createdData: Record<string, unknown> | null = null;
let txCreatedData: Record<string, unknown> | null = null;
let createThrows = false;
let rows: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        auditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            if (createThrows) throw new Error("db unavailable");
            createdData = args.data;
            return { id: "audit-1", ...args.data };
          },
          count: async () => rows.length,
          findMany: async () => rows,
        },
      },
    },
  });
});

beforeEach(() => {
  createdData = null;
  txCreatedData = null;
  createThrows = false;
  rows = [];
});

test("recordAuditLog persists actor, target, request id and sanitized metadata", async () => {
  const { recordAuditLog } = await import("@/lib/security/audit");

  await recordAuditLog({
    action: "admin.member.role_update",
    actorId: "admin-1",
    actorRole: "Admin",
    targetType: "user",
    targetId: "reader-1",
    requestId: "req-1",
    ipAddress: "203.0.113.10",
    userAgent: "Mozilla/5.0",
    metadata: {
      previousRole: "Reader",
      role: "Admin",
      email: `reader${"@"}example.com`,
      accessToken: "secret-token-value",
    },
  });

  assert.equal(createdData?.action, "admin.member.role_update");
  assert.equal(createdData?.actorId, "admin-1");
  assert.equal(createdData?.targetId, "reader-1");
  assert.equal(createdData?.requestId, "req-1");
  const metadata = JSON.parse(String(createdData?.metadata));
  assert.deepEqual(metadata, {
    previousRole: "Reader",
    role: "Admin",
    email: "[redacted]",
    accessToken: "[redacted]",
  });
});

test("sanitizeAuditMetadata redacts secrets and PII-like values recursively", async () => {
  const { sanitizeAuditMetadata } = await import("@/lib/security/audit");

  const sanitized = sanitizeAuditMetadata({
    safe: "role-change",
    nested: {
      secretToken: "token-value",
      value: `alice${"@"}example.com`,
    },
    list: [
      "ok",
      [
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        "signaturevalue1234567890",
      ].join("."),
    ],
  });

  assert.equal(sanitized.safe, "role-change");
  assert.deepEqual(sanitized.nested, {
    secretToken: "[redacted]",
    // key "value" is not sensitive; email in the value is masked inline
    value: "[email]",
  });
  // JWT segments (24+ base64url chars) are masked inline as [token]
  assert.deepEqual(sanitized.list, ["ok", "[token].[token].[token]"]);
});

test("auditRequestInfo extracts bounded IP and user agent from request headers", async () => {
  const { auditRequestInfo } = await import("@/lib/security/audit");

  const info = auditRequestInfo(
    new Request("http://test", {
      headers: {
        "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        "user-agent": "ReadWiseTest/1.0",
      },
    }),
  );

  assert.deepEqual(info, {
    ipAddress: "198.51.100.7",
    userAgent: "ReadWiseTest/1.0",
  });
});

test("recordAuditLog throws when durable persistence fails", async () => {
  const { recordAuditLog } = await import("@/lib/security/audit");
  createThrows = true;

  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      recordAuditLog({
        action: "admin.article.delete",
        actorId: "admin-1",
        targetType: "article",
        targetId: "article-1",
      }),
      /db unavailable/,
    );
  } finally {
    console.error = originalError;
  }
});

test("recordAuditLog can write through a transaction client", async () => {
  const { recordAuditLog } = await import("@/lib/security/audit");
  const tx = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        txCreatedData = args.data;
        return { id: "audit-tx-1", ...args.data };
      },
    },
  };

  await recordAuditLog(
    {
      action: "admin.article.delete",
      actorId: "admin-1",
      targetType: "article",
      targetId: "article-1",
    },
    tx as unknown as Parameters<typeof recordAuditLog>[1],
  );

  assert.equal(createdData, null);
  assert.equal(txCreatedData?.action, "admin.article.delete");
});

test("listAuditLogs returns parsed metadata without exposing invalid JSON", async () => {
  const { listAuditLogs } = await import("@/lib/security/audit");
  rows = [
    {
      id: "audit-1",
      action: "account.export",
      actorId: "user-1",
      actorRole: "Reader",
      targetType: "account",
      targetId: "user-1",
      metadata: "{\"format\":\"json\"}",
      requestId: "req-1",
      ipAddress: null,
      userAgent: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "audit-2",
      action: "account.delete",
      actorId: "user-2",
      actorRole: "Reader",
      targetType: "account",
      targetId: "user-2",
      metadata: "not json",
      requestId: "req-2",
      ipAddress: null,
      userAgent: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  ];

  const result = await listAuditLogs({ pageSize: 10 });

  assert.equal(result.total, 2);
  assert.deepEqual(result.logs[0].metadata, { format: "json" });
  assert.deepEqual(result.logs[1].metadata, {});
});
