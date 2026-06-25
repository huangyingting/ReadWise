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

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((key) => `${key}="${escapePrometheusLabelValue(labels[key])}"`).join(",")}}`;
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
    if (!emitted.has(counter.name)) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      emitted.add(counter.name);
    }
    lines.push(`${counter.name}${renderLabels(counter.labels)} ${counter.value}`);
  }

  for (const histogram of snapshot.histograms) {
    if (!emitted.has(histogram.name)) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      emitted.add(histogram.name);
    }
    for (const bucket of histogram.buckets) {
      lines.push(
        `${histogram.name}_bucket${renderLabels({ ...histogram.labels, le: String(bucket.le) })} ${bucket.count}`,
      );
    }
    lines.push(`${histogram.name}_bucket${renderLabels({ ...histogram.labels, le: "+Inf" })} ${histogram.count}`);
    lines.push(`${histogram.name}_sum${renderLabels(histogram.labels)} ${histogram.sum}`);
    lines.push(`${histogram.name}_count${renderLabels(histogram.labels)} ${histogram.count}`);
  }

  return `${lines.join("\n")}\n`;
}
