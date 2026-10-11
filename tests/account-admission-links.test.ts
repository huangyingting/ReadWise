import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  accountAdmissionPublicOrigin,
  accountAdmissionSecretLink,
} from "@/lib/account-admission/links";

const URL_ENVS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_SITE_URL",
] as const;

beforeEach(() => {
  for (const name of URL_ENVS) delete process.env[name];
});

test("Account Admission links prefer the configured public application URL", () => {
  process.env.APP_URL = "https://readwise.example.test/app";
  process.env.NEXTAUTH_URL = "http://readwise:3000";

  assert.equal(
    accountAdmissionSecretLink(
      "/invite",
      "secret/token",
      "http://readwise:3000/api/admin/invitations",
    ),
    "https://readwise.example.test/invite/secret%2Ftoken",
  );
});

test("Account Admission links fall back through public aliases before request origin", () => {
  process.env.APP_URL = "not a URL";
  process.env.NEXT_PUBLIC_APP_URL = "https://public.example.test";
  process.env.NEXTAUTH_URL = "http://readwise:3000";

  assert.equal(
    accountAdmissionPublicOrigin("http://internal:3000/api"),
    "https://public.example.test",
  );
});

test("Account Admission links use the request origin only when no public URL is configured", () => {
  assert.equal(
    accountAdmissionSecretLink(
      "/invite",
      "token",
      "http://internal:3000/api/admin/invitations",
    ),
    "http://internal:3000/invite/token",
  );
  assert.equal(accountAdmissionSecretLink("/invite", "token"), null);
});
