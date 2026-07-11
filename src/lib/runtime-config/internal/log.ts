import { logLevel, type LogLevel } from "../observability";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldEmit(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[logLevel()];
}

export function warnRuntimeConfig(
  scope: string,
  message: string,
  meta: Record<string, unknown> = {},
): void {
  if (!shouldEmit("warn")) return;
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      scope,
      message,
      ...meta,
    }),
  );
}
