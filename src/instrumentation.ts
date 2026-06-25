/**
 * Next.js instrumentation hook (RW-032). Next calls {@link register} once per
 * server process at startup. We start the OpenTelemetry Node SDK here, but ONLY
 * in the Node.js runtime and ONLY when tracing is configured (see
 * `src/lib/observability/tracing-node.ts`). In the Edge runtime or when unconfigured this is
 * a no-op, so the build and tests stay green without a collector.
 */
export async function register(): Promise<void> {
  // The node-only tracing bootstrap MUST live inside a positive
  // `=== "nodejs"` block. Next.js statically replaces `process.env.NEXT_RUNTIME`
  // per build, so for the Edge bundle this becomes `if ("edge" === "nodejs")`,
  // letting webpack dead-code-eliminate the dynamic import of
  // `@opentelemetry/sdk-node` (which transitively pulls `@grpc/grpc-js` →
  // Node's `stream` builtin) out of the Edge graph entirely. An early-return
  // guard does NOT get tree-shaken reliably and breaks `next dev`/Edge compile
  // with "Can't resolve 'stream'".
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTracing } = await import("@/lib/observability/tracing-node");
    await startTracing();
  }
}
