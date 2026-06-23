/**
 * Next.js instrumentation hook (RW-032). Next calls {@link register} once per
 * server process at startup. We start the OpenTelemetry Node SDK here, but ONLY
 * in the Node.js runtime and ONLY when tracing is configured (see
 * `src/lib/tracing-node.ts`). In the Edge runtime or when unconfigured this is
 * a no-op, so the build and tests stay green without a collector.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTracing } = await import("@/lib/tracing-node");
  await startTracing();
}
