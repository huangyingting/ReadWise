/**
 * Tests for the default learner landing resolver (#799).
 *
 * The Today Session flag flips the learner default landing between `/today`
 * (enabled) and `/dashboard` (disabled) WITHOUT touching admin routing — admins
 * always keep the dashboard overview as their default.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLandingPath,
  DASHBOARD_PATH,
  TODAY_PATH,
} from "@/lib/learner-landing";

const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

beforeEach(() => {
  delete process.env[FLAG];
});

test("learner lands on /today when the flag is enabled (default)", () => {
  process.env[FLAG] = "true";
  assert.equal(defaultLandingPath("Reader"), TODAY_PATH);
});

test("learner lands on /dashboard when the flag is disabled", () => {
  process.env[FLAG] = "false";
  assert.equal(defaultLandingPath("Reader"), DASHBOARD_PATH);
});

test("admins always land on /dashboard regardless of the flag", () => {
  process.env[FLAG] = "true";
  assert.equal(defaultLandingPath("Admin"), DASHBOARD_PATH);
  process.env[FLAG] = "false";
  assert.equal(defaultLandingPath("Admin"), DASHBOARD_PATH);
});

test("unknown/absent role follows the flag (no role supplied)", () => {
  process.env[FLAG] = "true";
  assert.equal(defaultLandingPath(), TODAY_PATH);
  assert.equal(defaultLandingPath(null), TODAY_PATH);
});

test("defaults to enabled when the flag env var is absent", () => {
  // Convention: FEATURE_*_ENABLED defaults true when unset.
  assert.equal(defaultLandingPath("Reader"), TODAY_PATH);
});
