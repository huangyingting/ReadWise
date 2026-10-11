import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicMailAddress } from "@/lib/account-admission/public-mail-address";

test("direct email rejects private, reserved, and transition addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.88.99.1",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001::1",
    "2001:0:1234::1",
    "2001:20::1",
    "2001:db8::1",
    "2002:808:808::1",
    "3fff::1",
    "invalid-address",
  ]) {
    assert.equal(isPublicMailAddress(address), false, address);
  }
});

test("direct email permits public global-unicast addresses", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ]) {
    assert.equal(isPublicMailAddress(address), true, address);
  }
});
