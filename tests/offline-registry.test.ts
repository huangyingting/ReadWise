/**
 * Tests for src/lib/offline/registry.ts (REF-021).
 *
 * Pure registry logic — no IndexedDB / network. Covers type enumeration,
 * known-type guards, and endpoint prefix coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_MUTATION_REGISTRY,
  isKnownMutationType,
  getMutationRegistration,
  type OfflineMutationType,
} from "@/lib/offline/registry";

// ---------------------------------------------------------------------------
// Registry completeness
// ---------------------------------------------------------------------------

test("OFFLINE_MUTATION_REGISTRY is non-empty and has unique types", () => {
  assert.ok(OFFLINE_MUTATION_REGISTRY.length > 0, "registry should not be empty");
  const types = OFFLINE_MUTATION_REGISTRY.map((r) => r.type);
  const unique = new Set(types);
  assert.equal(unique.size, types.length, "every type must be unique in the registry");
});

test("OFFLINE_MUTATION_REGISTRY entries all have non-empty endpointPrefixes", () => {
  for (const entry of OFFLINE_MUTATION_REGISTRY) {
    assert.ok(
      entry.endpointPrefixes.length > 0,
      `type '${entry.type}' must declare at least one endpoint prefix`,
    );
    for (const prefix of entry.endpointPrefixes) {
      assert.ok(
        prefix.startsWith("/"),
        `endpointPrefix '${prefix}' for '${entry.type}' must start with '/'`,
      );
    }
  }
});

test("OFFLINE_MUTATION_REGISTRY entries all have a valid HTTP method", () => {
  const allowed = new Set(["POST", "PATCH", "DELETE"]);
  for (const entry of OFFLINE_MUTATION_REGISTRY) {
    assert.ok(
      allowed.has(entry.method),
      `type '${entry.type}' has unexpected method '${entry.method}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// isKnownMutationType
// ---------------------------------------------------------------------------

test("isKnownMutationType returns true for every registered type", () => {
  for (const entry of OFFLINE_MUTATION_REGISTRY) {
    assert.equal(
      isKnownMutationType(entry.type),
      true,
      `isKnownMutationType should accept '${entry.type}'`,
    );
  }
});

test("isKnownMutationType returns false for unregistered types", () => {
  assert.equal(isKnownMutationType(""), false);
  assert.equal(isKnownMutationType("unknown"), false);
  assert.equal(isKnownMutationType("PROGRESS"), false, "type lookup is case-sensitive");
});

// ---------------------------------------------------------------------------
// getMutationRegistration
// ---------------------------------------------------------------------------

test("getMutationRegistration returns the correct entry for known types", () => {
  const reg = getMutationRegistration("progress");
  assert.ok(reg !== undefined, "should find 'progress' entry");
  assert.equal(reg!.type, "progress");
  assert.equal(reg!.method, "POST");
  assert.ok(reg!.endpointPrefixes.includes("/api/progress"));
});

test("getMutationRegistration returns undefined for unknown types", () => {
  assert.equal(getMutationRegistration("nonexistent"), undefined);
  assert.equal(getMutationRegistration(""), undefined);
});

// ---------------------------------------------------------------------------
// Known mutation types are covered
// ---------------------------------------------------------------------------

const EXPECTED_TYPES: OfflineMutationType[] = [
  "progress",
  "saveWord",
  "removeWord",
  "highlight.create",
  "highlight.color",
  "highlight.note",
  "highlight.delete",
  "quiz.attempt",
];

test("registry covers all expected offline mutation types", () => {
  for (const type of EXPECTED_TYPES) {
    assert.equal(
      isKnownMutationType(type),
      true,
      `expected type '${type}' to be registered`,
    );
  }
});

test("registry entry for quiz.attempt uses POST", () => {
  const reg = getMutationRegistration("quiz.attempt");
  assert.ok(reg !== undefined);
  assert.equal(reg!.method, "POST");
});

test("registry entry for highlight.delete uses DELETE", () => {
  const reg = getMutationRegistration("highlight.delete");
  assert.ok(reg !== undefined);
  assert.equal(reg!.method, "DELETE");
});

test("registry entry for removeWord uses DELETE", () => {
  const reg = getMutationRegistration("removeWord");
  assert.ok(reg !== undefined);
  assert.equal(reg!.method, "DELETE");
});
