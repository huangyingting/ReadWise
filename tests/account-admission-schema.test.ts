import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("Prisma models Account Invitations and password registration lifecycle", async () => {
  const schema = await readFile(
    resolve(import.meta.dirname, "../prisma/base.prisma"),
    "utf8",
  );

  assert.match(schema, /enum AccountInvitationStatus\s*\{[\s\S]*PENDING[\s\S]*ACCEPTED[\s\S]*REVOKED[\s\S]*EXPIRED/);
  assert.match(schema, /model AccountInvitation\s*\{/);
  assert.match(schema, /activeForEmail\s+String\?\s+@unique/);
  assert.match(schema, /tokenHash\s+String\?\s+@unique/);
  assert.match(schema, /model PasswordCredential\s*\{/);
  assert.match(schema, /userId\s+String\s+@unique/);
  assert.match(schema, /model PendingRegistration\s*\{/);
  assert.match(schema, /normalizedEmail\s+String\s+@unique/);
  assert.match(schema, /model AccountEmailOutbox\s*\{/);
  assert.match(schema, /status\s+String\s+@default\("pending"\)/);
  assert.match(schema, /claimToken\s+String\?/);
  assert.match(schema, /@@index\(\[status, createdAt\]\)/);
});
