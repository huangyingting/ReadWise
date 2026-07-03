/**
 * Node-only OpenTelemetry SDK bootstrap (RW-032).
 *
 * Imported lazily from {@link "../../instrumentation".register} ONLY in the
 * Node.js runtime. Kept separate from `observability/tracing.ts` (which is the
 * API-only, import-anywhere helper) so the heavy `@opentelemetry/sdk-node`
 * dependency never reaches the Edge/Client bundles.
 *
 * GRACEFUL DEGRADATION: when {@link tracingConfig} returns `null` (no collector
 * endpoint and `TRACING_ENABLED` not set) this returns without starting the
 * SDK, leaving the OTel API as a no-op. Tracing therefore costs nothing — and
 * needs no collector — at build time or in CI.
 *
 * Part of the observability package (REF-053). This is the canonical
 * implementation.
 */
import { tracingConfig } from "@/lib/runtime-config/observability";
import { createLogger } from "./logger";

const log = createLogger("tracing");

let started = false;

type TracingModules = Awaited<ReturnType<typeof loadTracingModules>>;

async function loadTracingModules() {
  const [
    { NodeSDK },
    { resourceFromAttributes },
    semconv,
    { OTLPTraceExporter },
    { ConsoleSpanExporter },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/semantic-conventions"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/sdk-trace-base"),
  ]);

  return {
    NodeSDK,
    resourceFromAttributes,
    semconv,
    OTLPTraceExporter,
    ConsoleSpanExporter,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createTraceExporter(
  config: NonNullable<ReturnType<typeof tracingConfig>>,
  modules: Pick<TracingModules, "OTLPTraceExporter" | "ConsoleSpanExporter">,
) {
  return config.exporter === "otlp"
    ? new modules.OTLPTraceExporter(
        config.endpoint ? { url: config.endpoint } : {},
      )
    : new modules.ConsoleSpanExporter();
}

/**
 * Initialize the OpenTelemetry Node SDK if tracing is configured. Idempotent
 * and never throws — any failure logs a warning and leaves tracing disabled so
 * the app keeps running.
 */
export async function startTracing(): Promise<void> {
  if (started) return;
  const config = tracingConfig();
  if (!config) {
    log.debug("tracing.disabled");
    return;
  }
  started = true;

  try {
    const modules = await loadTracingModules();

    const traceExporter = createTraceExporter(config, modules);

    const resource = modules.resourceFromAttributes({
      [modules.semconv.ATTR_SERVICE_NAME]: config.serviceName,
      [modules.semconv.ATTR_SERVICE_VERSION]: config.serviceVersion,
      "deployment.environment.name": config.environment,
    });

    const sdk = new modules.NodeSDK({ resource, traceExporter });
    sdk.start();
    log.info("tracing.started", {
      exporter: config.exporter,
      serviceName: config.serviceName,
      environment: config.environment,
    });

    const shutdown = () => {
      void sdk
        .shutdown()
        .catch((err: unknown) =>
          log.warn("tracing.shutdown_failed", {
            error: errorMessage(err),
          }),
        );
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch (err) {
    // Never let a tracing init failure break the app.
    started = false;
    log.warn("tracing.init_failed", {
      error: errorMessage(err),
    });
  }
}
