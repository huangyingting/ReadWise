/**
 * Tenant membership capability tests (RW-060/061).
 *
 * Pure capability-model checks (no mocks): the new `MEMBERSHIP_ROLES` /
 * `CLASSROOM_ROLES` resolve through the SAME `@/lib/rbac` capability table as
 * global roles, so tenant authorization is consistent with system authorization.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITIES,
  MEMBERSHIP_ROLES,
  CLASSROOM_ROLES,
  membershipCapabilities,
  membershipHasCapability,
} from "@/lib/rbac";

test("MEMBERSHIP_ROLES / CLASSROOM_ROLES enumerate the tenant role sets", () => {
  assert.deepEqual([...MEMBERSHIP_ROLES], ["OrgAdmin", "Teacher", "Member", "Student"]);
  assert.deepEqual([...CLASSROOM_ROLES], ["Teacher", "Student"]);
});

test("OrgAdmin membership grants org + classroom management", () => {
  assert.ok(membershipHasCapability("OrgAdmin", CAPABILITIES.orgManage));
  assert.ok(membershipHasCapability("OrgAdmin", CAPABILITIES.orgMembersManage));
  assert.ok(membershipHasCapability("OrgAdmin", CAPABILITIES.classroomManage));
});

test("Teacher membership manages classrooms but NOT the org", () => {
  assert.ok(membershipHasCapability("Teacher", CAPABILITIES.classroomManage));
  assert.ok(membershipHasCapability("Teacher", CAPABILITIES.classroomAssignmentsManage));
  assert.ok(!membershipHasCapability("Teacher", CAPABILITIES.orgManage));
});

test("Member / Student carry only base reader capabilities (no privilege)", () => {
  for (const role of ["Member", "Student"] as const) {
    assert.ok(membershipHasCapability(role, CAPABILITIES.articlesRead));
    assert.ok(!membershipHasCapability(role, CAPABILITIES.classroomManage));
    assert.ok(!membershipHasCapability(role, CAPABILITIES.orgManage));
    assert.ok(!membershipHasCapability(role, CAPABILITIES.adminAccess));
  }
});

test("no tenant membership role grants SYSTEM admin access", () => {
  for (const role of MEMBERSHIP_ROLES) {
    assert.ok(!membershipHasCapability(role, CAPABILITIES.adminAccess));
  }
});

test("an unknown / null membership role resolves to no capabilities", () => {
  assert.deepEqual(membershipCapabilities("Nonsense"), []);
  assert.deepEqual(membershipCapabilities(null), []);
  assert.deepEqual(membershipCapabilities(undefined), []);
});
