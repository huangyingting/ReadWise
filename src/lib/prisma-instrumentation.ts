/**
 * Prisma query timing instrumentation.
 *
 * This module measures Prisma model operations plus root raw-query helpers
 * without logging SQL text, bind parameters, args, article text, prompts,
 * selected text, user ids, or raw ids.
 */

import { performance } from "node:perf_hooks";

import {
  normalizeDbModel,
  normalizeDbOperation,
  normalizeDbProvider,
  recordDbQuery,
  type DbQueryOutcome,
} from "@/lib/metrics";
import { createLogger } from "@/lib/observability/logger";
import { markSpanError, setSpanAttributes, startChildSpan } from "@/lib/observability/tracing";

type PrismaOperation = {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

type PrismaExtension = {
  name: string;
  query: {
    $allModels: {
      $allOperations: (operation: PrismaOperation) => Promise<unknown>;
    };
  };
};

type InstrumentableClient = Record<string | symbol, unknown> & {
  $extends?: (extension: PrismaExtension) => unknown;
};

type InstrumentationOptions = {
  enabled: boolean;
  provider: string | null | undefined;
  slowThresholdMs: number;
};

type RawMethod = "$queryRaw" | "$executeRaw" | "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction";

const INSTRUMENTED = Symbol.for("readwise.prisma.instrumented");
const RAW_METHODS: RawMethod[] = ["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "$transaction"];
const log = createLogger("db", {}, { includeRequestContext: false });

async function measurePrismaQuery<T>(
  provider: string | null | undefined,
  slowThresholdMs: number,
  model: string | null | undefined,
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  let outcome: DbQueryOutcome = "success";
  const span = startChildSpan("db.query", {
    "readwise.db_provider": normalizeDbProvider(provider),
    "readwise.db_model": normalizeDbModel(model),
    "readwise.db_operation": normalizeDbOperation(operation),
  });

  try {
    return await run();
  } catch (error) {
    outcome = "error";
    markSpanError(span, "db.query failed");
    throw error;
  } finally {
    const durationMs = performance.now() - startedAt;
    const slow = durationMs >= slowThresholdMs;
    const roundedDurationMs = Math.round(durationMs);
    recordDbQuery({
      provider,
      model,
      operation,
      outcome,
      durationMs,
      slow,
    });
    setSpanAttributes(span, {
      "readwise.outcome": outcome,
      "readwise.duration_ms": roundedDurationMs,
      "readwise.slow": slow,
    });
    span.end();

    if (slow) {
      log.warn("db.slow_query", {
        provider: normalizeDbProvider(provider),
        model: normalizeDbModel(model),
        operation: normalizeDbOperation(operation),
        outcome,
        durationMs: roundedDurationMs,
        thresholdMs: slowThresholdMs,
      });
    }
  }
}

function queryExtension(provider: string | null | undefined, slowThresholdMs: number): PrismaExtension {
  return {
    name: "readwise-prisma-query-timing",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: PrismaOperation): Promise<unknown> {
          return measurePrismaQuery(provider, slowThresholdMs, model, operation, () => query(args));
        },
      },
    },
  };
}

function rawOperationName(method: RawMethod): string {
  return method.replace(/^\$/, "");
}

function patchRawMethod(
  client: InstrumentableClient,
  provider: string | null | undefined,
  slowThresholdMs: number,
  method: RawMethod,
): void {
  const current = client[method];
  if (typeof current !== "function") return;
  const original = current.bind(client) as (...args: unknown[]) => Promise<unknown>;
  try {
    Object.defineProperty(client, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) =>
        measurePrismaQuery(provider, slowThresholdMs, "client", rawOperationName(method), () => original(...args)),
    });
  } catch {
    log.warn("db.raw_instrumentation_skipped", {
      provider: normalizeDbProvider(provider),
      operation: normalizeDbOperation(rawOperationName(method)),
    });
  }
}

function patchRawMethods(
  client: InstrumentableClient,
  provider: string | null | undefined,
  slowThresholdMs: number,
): void {
  for (const method of RAW_METHODS) {
    patchRawMethod(client, provider, slowThresholdMs, method);
  }
}

export function instrumentPrismaClient<T extends object>(
  client: T,
  options: InstrumentationOptions,
): T {
  if (!options.enabled) return client;

  let instrumented = client as InstrumentableClient;
  if (instrumented[INSTRUMENTED]) return client;

  if (typeof instrumented.$extends === "function") {
    try {
      instrumented = instrumented.$extends(queryExtension(options.provider, options.slowThresholdMs)) as InstrumentableClient;
    } catch {
      log.warn("db.model_instrumentation_skipped", {
        provider: normalizeDbProvider(options.provider),
      });
      instrumented = client as InstrumentableClient;
    }
  }

  patchRawMethods(instrumented, options.provider, options.slowThresholdMs);
  instrumented[INSTRUMENTED] = true;
  return instrumented as T;
}
