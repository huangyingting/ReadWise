/**
 * Report utilities for the AI evaluation harness.
 */

import type { EvalReport } from "@/lib/ai/evals/types";

type EvalFailure = {
  feature: string;
  caseName: string;
  property: string;
  detail?: string;
};

/** A flat list of every property failure (for concise CI assertions/logs). */
export function collectFailures(report: EvalReport): EvalFailure[] {
  const failures: EvalFailure[] = [];
  for (const feature of report.features) {
    for (const caseResult of feature.cases) {
      for (const property of caseResult.properties) {
        if (!property.passed) {
          failures.push(toFailure(feature.feature, caseResult.caseName, property));
        }
      }
    }
  }
  return failures;
}

function toFailure(
  feature: string,
  caseName: string,
  property: EvalReport["features"][number]["cases"][number]["properties"][number],
): EvalFailure {
  return {
    feature,
    caseName,
    property: property.name,
    detail: property.detail,
  };
}
