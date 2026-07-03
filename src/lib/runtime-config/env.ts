/**
 * Shared low-level environment helpers for runtime-config modules.
 *
 * @server-only — Never import from a Client Component.
 * See ADR-0010.
 *
 * IMPORTANT: server-only. Never import from a Client Component.
 */

/** A configured-or-null view over a multi-variable feature's environment. */
export type FeatureConfig<T> = {
  /** The typed config object, or `null` when any required var is missing. */
  get(): T | null;
  /** Whether every required env var for this feature is present. */
  isConfigured(): boolean;
};

export type ConfigIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  env: string[];
};

export type ConfigCheckStatus =
  | "ok"
  | "missing"
  | "malformed"
  | "configured"
  | "unconfigured"
  | "degraded";

export type ConfigCheckReport = {
  status: ConfigCheckStatus;
  configured: boolean;
  required: boolean;
  env: string[];
  missing: string[];
  issues: ConfigIssue[];
};

export type RuntimeConfigReport = {
  ready: boolean;
  status: "ready" | "unavailable";
  checkedAt: string;
  required: {
    database: ConfigCheckReport;
    auth: ConfigCheckReport;
  };
  optional: {
    ai: ConfigCheckReport;
    speech: ConfigCheckReport;
    push: ConfigCheckReport;
    googleOAuth: ConfigCheckReport;
    azureAdOAuth: ConfigCheckReport;
    storage: ConfigCheckReport;
    scraper: ConfigCheckReport;
  };
  tuning: ConfigCheckReport;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
};

type EnvValues = Record<string, string | null>;
type ConfigValidator = (values: Record<string, string>) => ConfigIssue | null;

/** Wraps a `read` function into a {@link FeatureConfig}. */
export function defineFeatureConfig<T>(read: () => T | null): FeatureConfig<T> {
  return {
    get: read,
    isConfigured: () => read() !== null,
  };
}

export function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function issue(
  severity: ConfigIssue["severity"],
  code: string,
  message: string,
  env: string[],
): ConfigIssue {
  return { severity, code, message, env };
}

export function httpUrlIssue(
  name: string,
  value: string,
  severity: ConfigIssue["severity"] = "error",
): ConfigIssue | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return issue(severity, "invalid_url_protocol", `${name} must use http or https.`, [name]);
    }
    return null;
  } catch {
    return issue(severity, "invalid_url", `${name} must be a valid URL.`, [name]);
  }
}

export function evaluateRequired(
  env: string[],
  validators: ConfigValidator[],
): ConfigCheckReport {
  const values = readEnvValues(env);
  const missing = missingEnv(env, values);
  const issues = missing.length
    ? [missingRequiredIssue(missing)]
    : validationIssues(validators, values);
  const hasErrors = issues.some((item) => item.severity === "error");
  return {
    status: missing.length ? "missing" : hasErrors ? "malformed" : "ok",
    configured: missing.length === 0 && !hasErrors,
    required: true,
    env,
    missing,
    issues,
  };
}

export function evaluateOptional(
  env: string[],
  validators: ConfigValidator[] = [],
): ConfigCheckReport {
  const values = readEnvValues(env);
  const present = env.filter((name) => values[name]);
  const missing = missingEnv(env, values);

  if (present.length === 0) {
    return {
      status: "unconfigured",
      configured: false,
      required: false,
      env,
      missing: [],
      issues: [],
    };
  }

  const issues: ConfigIssue[] = [];
  if (missing.length > 0) {
    issues.push(partialOptionalProviderIssue(missing));
  }

  issues.push(...validationIssues(validators, values));

  const degraded = missing.length > 0 || issues.length > 0;
  return {
    status: degraded ? "degraded" : "configured",
    configured: !degraded,
    required: false,
    env,
    missing,
    issues,
  };
}

/** Read a positive-int env var, returning `fallback` when unset/invalid/<=0. */
export function positiveIntEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readEnvValues(env: string[]): EnvValues {
  return Object.fromEntries(env.map((name) => [name, envValue(name)]));
}

function missingEnv(env: string[], values: EnvValues): string[] {
  return env.filter((name) => !values[name]);
}

function validationIssues(validators: ConfigValidator[], values: EnvValues): ConfigIssue[] {
  return validators.flatMap((validate) => {
    const result = validate(values as Record<string, string>);
    return result ? [result] : [];
  });
}

function missingRequiredIssue(missing: string[]): ConfigIssue {
  return issue(
    "error",
    "missing_required_env",
    `Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    missing,
  );
}

function partialOptionalProviderIssue(missing: string[]): ConfigIssue {
  return issue(
    "warning",
    "partial_optional_provider",
    `Optional provider is partially configured; missing ${missing.join(", ")}.`,
    missing,
  );
}
