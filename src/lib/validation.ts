/**
 * Tiny dependency-free schema validation toolkit used by the shared API handler
 * (US-028). Each {@link Schema} maps an `unknown` input to a typed value or a
 * human-readable error. Client-provided data (bodies, ids, query params) is
 * NEVER trusted — it always passes through a schema before a handler sees it.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type Schema<T> = (value: unknown, field?: string) => ValidationResult<T>;

const label = (field?: string) => (field ? field : "value");

/** A required, optionally length-bounded string (trimmed by default). */
export function string(opts: {
  min?: number;
  max?: number;
  trim?: boolean;
} = {}): Schema<string> {
  const { min = 0, max = Infinity, trim = true } = opts;
  return (value, field) => {
    if (typeof value !== "string") {
      return { ok: false, error: `${label(field)} must be a string` };
    }
    const out = trim ? value.trim() : value;
    if (out.length < min) {
      return {
        ok: false,
        error:
          min === 1
            ? `${label(field)} is required`
            : `${label(field)} must be at least ${min} characters`,
      };
    }
    if (out.length > max) {
      return { ok: false, error: `${label(field)} must be at most ${max} characters` };
    }
    return { ok: true, value: out };
  };
}

/** A non-empty trimmed string (e.g. ids, words). */
export function nonEmptyString(max = 10_000): Schema<string> {
  return string({ min: 1, max });
}

/** A finite number, optionally bounded / integer-only. Accepts numeric strings. */
export function number(opts: {
  min?: number;
  max?: number;
  int?: boolean;
} = {}): Schema<number> {
  const { min = -Infinity, max = Infinity, int = false } = opts;
  return (value, field) => {
    const num = typeof value === "string" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num)) {
      return { ok: false, error: `${label(field)} must be a number` };
    }
    if (int && !Number.isInteger(num)) {
      return { ok: false, error: `${label(field)} must be an integer` };
    }
    if (num < min || num > max) {
      return { ok: false, error: `${label(field)} must be between ${min} and ${max}` };
    }
    return { ok: true, value: num };
  };
}

/**
 * A number coerced into an integer and CLAMPED to `[min, max]` (rather than
 * rejected). Accepts numeric strings. Only non-finite / non-numeric input is
 * rejected. Useful for client-derived scores (e.g. pronunciation 0–100) where a
 * forged/out-of-range value should be bounded instead of trusted verbatim.
 */
export function clampedInt(min: number, max: number): Schema<number> {
  return (value, field) => {
    const num = typeof value === "string" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num)) {
      return { ok: false, error: `${label(field)} must be a number` };
    }
    const clamped = Math.min(max, Math.max(min, Math.round(num)));
    return { ok: true, value: clamped };
  };
}

/** A boolean. */
export function boolean(): Schema<boolean> {
  return (value, field) => {
    if (typeof value !== "boolean") {
      return { ok: false, error: `${label(field)} must be a boolean` };
    }
    return { ok: true, value };
  };
}

/** One of a fixed set of literal values. */
export function oneOf<T extends string | number>(values: readonly T[]): Schema<T> {
  return (value, field) => {
    if (!values.includes(value as T)) {
      return {
        ok: false,
        error: `${label(field)} must be one of: ${values.join(", ")}`,
      };
    }
    return { ok: true, value: value as T };
  };
}

/** An array whose items each satisfy `item`. Bounded by `max`. */
export function array<T>(item: Schema<T>, opts: { max?: number } = {}): Schema<T[]> {
  const { max = 1000 } = opts;
  return (value, field) => {
    if (!Array.isArray(value)) {
      return { ok: false, error: `${label(field)} must be an array` };
    }
    if (value.length > max) {
      return { ok: false, error: `${label(field)} must have at most ${max} items` };
    }
    const out: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const res = item(value[i], `${label(field)}[${i}]`);
      if (!res.ok) return res;
      out.push(res.value);
    }
    return { ok: true, value: out };
  };
}

/** Allows `undefined`/`null` (mapped to `undefined`); otherwise delegates. */
export function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return (value, field) => {
    if (value === undefined || value === null) {
      return { ok: true, value: undefined };
    }
    return inner(value, field);
  };
}

type Shape = Record<string, Schema<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };

/**
 * An object whose keys are validated by `shape`. Unknown keys are dropped so
 * clients cannot smuggle extra fields into trusted code paths.
 */
export function object<S extends Shape>(shape: S): Schema<Infer<S>> {
  return (value, field) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: `${label(field)} must be an object` };
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const res = shape[key](record[key], key);
      if (!res.ok) return res;
      out[key] = res.value;
    }
    return { ok: true, value: out as Infer<S> };
  };
}

/** Runs `schema` and returns the value or throws nothing — caller handles result. */
export function validate<T>(schema: Schema<T>, value: unknown): ValidationResult<T> {
  return schema(value);
}

/** Standard `[id]` route-param schema: requires a non-empty `id`. */
export const idParams: Schema<{ id: string }> = object({ id: nonEmptyString(200) });

/* ------------------------------------------------------------------ */
/* Query-string coercion helpers (operate on URLSearchParams)          */
/* ------------------------------------------------------------------ */

/** Reads a string query param, falling back to `fallback` when absent. */
export function queryString(
  params: URLSearchParams,
  name: string,
  fallback = "",
): string {
  const raw = params.get(name);
  return raw === null ? fallback : raw;
}

/** Reads an integer query param, clamped to `[min, max]`, defaulting to `fallback`. */
export function queryInt(
  params: URLSearchParams,
  name: string,
  opts: { fallback: number; min?: number; max?: number },
): number {
  const { fallback, min = -Infinity, max = Infinity } = opts;
  const parsed = Number.parseInt(params.get(name) ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Extracts `offset` (≥ 0) and `limit` (1..maxLimit) from URL search params.
 * Covers the standard pattern used by all article-listing and pagination routes.
 */
export function parsePaginationParams(
  params: URLSearchParams,
  opts: { defaultLimit: number; maxLimit: number },
): { offset: number; limit: number } {
  return {
    offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
    limit: queryInt(params, "limit", { fallback: opts.defaultLimit, min: 1, max: opts.maxLimit }),
  };
}
