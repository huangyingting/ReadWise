import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invitationAdminSource = readFileSync(
  new URL(
    "../src/app/admin/invitations/InvitationAdmin.tsx",
    import.meta.url,
  ),
  "utf8",
);
const authenticationSettingsSource = readFileSync(
  new URL(
    "../src/app/(app)/settings/AuthenticationSettings.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("async account forms retain their form element before awaiting", () => {
  for (const source of [invitationAdminSource, authenticationSettingsSource]) {
    assert.match(source, /const formElement = event\.currentTarget;/);
    assert.match(source, /new FormData\(formElement\)/);
    assert.match(source, /formElement\.reset\(\)/);
    assert.doesNotMatch(source, /event\.currentTarget\.reset\(\)/);
  }
});

test("Account Invitation expiry defaults to seven days with an optional calendar", () => {
  assert.match(
    invitationAdminSource,
    /name="expiresAt"\s+type="datetime-local"/,
  );
  assert.match(invitationAdminSource, /Leave expiry blank to use seven days/);
  assert.match(
    invitationAdminSource,
    /aria-describedby="invitation-expiry-hint"/,
  );
  assert.match(invitationAdminSource, /md:grid-cols-2/);
});

test("Account Invitation UI distinguishes queued workflow delivery", () => {
  assert.match(invitationAdminSource, /queued for the GitHub Actions sender/);
  assert.match(invitationAdminSource, /public application URL is unavailable/);
  assert.doesNotMatch(invitationAdminSource, /invitation email was sent/i);
});

test("Account Invitation management explains revoke and retention semantics", () => {
  assert.match(invitationAdminSource, /Invitation history/);
  assert.match(invitationAdminSource, /can be rotated or revoked/);
  assert.match(invitationAdminSource, /retention maintenance removes them/);
  assert.match(invitationAdminSource, /"DELETE"/);
});
