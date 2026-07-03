/**
 * Prometheus text-format exporter.
 *
 * Serializes the current in-process metrics snapshot into the Prometheus
 * exposition format (text/plain; version=0.0.4). The output is byte-for-byte
 * stable for a given snapshot: counters before histograms, both sorted by name
 * then label key-value string, HELP/TYPE headers emitted once per metric name.
 */

import { getMetricsSnapshot } from "@/lib/metrics/registry";

/** Escape a Prometheus label value per the text-format specification. Exported for testing. */
export function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

type MetricType = "counter" | "histogram";

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((key) => `${key}="${escapePrometheusLabelValue(labels[key])}"`).join(",")}}`;
}

function emitMetricHeaderOnce(
  lines: string[],
  emitted: Set<string>,
  name: string,
  help: string,
  type: MetricType,
): void {
  if (emitted.has(name)) return;

  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  emitted.add(name);
}

function renderHistogramLabels(labels: Record<string, string>, le: string): string {
  return renderLabels({ ...labels, le });
}

/**
 * Render all current metrics as a Prometheus exposition text string.
 *
 * The returned string ends with a trailing newline as required by the format.
 */
export function exportMetricsPrometheus(): string {
  const snapshot = getMetricsSnapshot();
  const lines: string[] = [];
  const emitted = new Set<string>();

  for (const counter of snapshot.counters) {
    emitMetricHeaderOnce(lines, emitted, counter.name, counter.help, "counter");
    lines.push(`${counter.name}${renderLabels(counter.labels)} ${counter.value}`);
  }

  for (const histogram of snapshot.histograms) {
    emitMetricHeaderOnce(lines, emitted, histogram.name, histogram.help, "histogram");
    for (const bucket of histogram.buckets) {
      lines.push(
        `${histogram.name}_bucket${renderHistogramLabels(histogram.labels, String(bucket.le))} ${bucket.count}`,
      );
    }
    lines.push(`${histogram.name}_bucket${renderHistogramLabels(histogram.labels, "+Inf")} ${histogram.count}`);
    lines.push(`${histogram.name}_sum${renderLabels(histogram.labels)} ${histogram.sum}`);
    lines.push(`${histogram.name}_count${renderLabels(histogram.labels)} ${histogram.count}`);
  }

  return `${lines.join("\n")}\n`;
}
