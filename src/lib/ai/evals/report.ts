/**
 * Report utilities for the AI evaluation harness.
 */

import type { EvalReport } from "@/lib/ai/evals/types";

/** A flat list of every property failure (for concise CI assertions/logs). */
export function collectFailures(report: EvalReport): Array<{
  feature: string;
  caseName: string;
  property: string;
  detail?: string;
}> {
  const failures: Array<{ feature: string; caseName: string; property: string; detail?: string }> =
    [];
  for (const feature of report.features) {
    for (const caseResult of feature.cases) {
      for (const property of caseResult.properties) {
        if (!property.passed) {
          failures.push({
            feature: feature.feature,
            caseName: caseResult.caseName,
            property: property.name,
            detail: property.detail,
          });
        }
      }
    }
  }
  return failures;
}
