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
  assert.match(invitationAdminSource, /name="expiresAt" type="datetime-local"/);
  assert.match(invitationAdminSource, /Leave blank for seven days/);
});

test("Account Invitation UI does not claim ambiguous delivery failed", () => {
  assert.match(invitationAdminSource, /delivery_unconfirmed/);
  assert.match(invitationAdminSource, /could not be confirmed/);
  assert.match(invitationAdminSource, /Do not resend automatically/);
});
