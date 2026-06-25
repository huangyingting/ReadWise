/**
 * PostgreSQL EXPLAIN / query-plan helpers for integration tests.
 *
 * Provides utilities to run EXPLAIN (FORMAT JSON) queries, extract the index
 * names used by the planner, and assert that expected indexes appear in the
 * plan.  Queries are run inside a transaction with enable_seqscan disabled so
 * the planner is forced to prefer indexes.
 */

import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";

export type ExplainRow = { "QUERY PLAN": unknown };
export type PlanNode = Record<string, unknown>;

export function asPlanNodes(value: unknown): PlanNode[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("EXPLAIN JSON result should be an array");
  }
  return parsed as PlanNode[];
}

export function collectIndexNames(node: unknown, result = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") {
    return result;
  }
  const record = node as PlanNode;
  const indexName = record["Index Name"];
  if (typeof indexName === "string") {
    result.add(indexName);
  }
  const plans = record.Plans;
  if (Array.isArray(plans)) {
    for (const child of plans) {
      collectIndexNames(child, result);
    }
  }
  return result;
}

export function indexesFromExplainRows(rows: ExplainRow[]): Set<string> {
  const indexes = new Set<string>();
  for (const row of rows) {
    for (const plan of asPlanNodes(row["QUERY PLAN"])) {
      collectIndexNames(plan.Plan, indexes);
    }
  }
  return indexes;
}

export async function explainIndexNames(sql: string, ...params: unknown[]): Promise<Set<string>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    const rows = await tx.$queryRawUnsafe<ExplainRow[]>(
      `EXPLAIN (FORMAT JSON, COSTS OFF) ${sql}`,
      ...params,
    );
    return indexesFromExplainRows(rows);
  });
}

export function assertUsesIndexes(actual: Set<string>, expected: string[]): void {
  for (const indexName of expected) {
    assert.ok(
      actual.has(indexName),
      `expected plan to use ${indexName}; used indexes: ${[...actual].sort().join(", ") || "(none)"}`,
    );
  }
}

export function assertUsesAnyIndex(actual: Set<string>, expected: string[]): void {
  assert.ok(
    expected.some((indexName) => actual.has(indexName)),
    `expected plan to use one of ${expected.join(", ")}; used indexes: ${[...actual].sort().join(", ") || "(none)"}`,
  );
}
